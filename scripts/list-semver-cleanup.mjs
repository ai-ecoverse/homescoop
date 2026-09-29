#!/usr/bin/env node
/**
 * List npm unpublish / deprecate commands for:
 *
 *   A. Semver trap: plain X.Y.Z that outranks X.Y.Z-N under caret ranges
 *   B. Versions that semver-gt dist-tag latest
 *   C. REMOVE_ENTIRELY packages (e.g. wasm-ffmpeg — codec distribution)
 *
 * THIS SCRIPT ONLY PRINTS COMMANDS. It never runs npm unpublish/deprecate.
 * Lars runs the printed commands with npm 2FA.
 *
 *   node scripts/list-semver-cleanup.mjs
 *   node scripts/list-semver-cleanup.mjs --json
 *   node scripts/list-semver-cleanup.mjs --include-latest-plain
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REMOVE_ENTIRELY, isRecipeRetired } from './recipe-status.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const asJson = process.argv.includes('--json');
const includeLatestPlain = process.argv.includes('--include-latest-plain');

const PLAIN = /^(\d+)\.(\d+)\.(\d+)$/;
const PACKREV = /^(\d+)\.(\d+)\.(\d+)-(\d+)$/;

function parseSemver(v) {
  let m = v.match(PACKREV);
  if (m) {
    return {
      major: +m[1],
      minor: +m[2],
      patch: +m[3],
      pre: +m[4],
      plain: false,
    };
  }
  m = v.match(PLAIN);
  if (m) {
    return {
      major: +m[1],
      minor: +m[2],
      patch: +m[3],
      pre: null,
      plain: true,
    };
  }
  return null;
}

/** Strict precedence: plain > any prerelease of same X.Y.Z; then numeric. */
function cmp(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return String(a).localeCompare(String(b));
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  if (pa.pre === null && pb.pre !== null) return 1;
  if (pa.pre !== null && pb.pre === null) return -1;
  if (pa.pre !== null && pb.pre !== null) return pa.pre - pb.pre;
  return 0;
}

function gt(a, b) {
  return cmp(a, b) > 0;
}

function baseOf(v) {
  const p = parseSemver(v);
  if (!p) return null;
  return `${p.major}.${p.minor}.${p.patch}`;
}

async function fetchPkg(name) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

function localNpmNames() {
  const out = [];
  for (const name of readdirSync(join(root, 'packages'))) {
    if (isRecipeRetired(name)) continue;
    const pj = join(root, 'packages', name, 'package', 'package.json');
    if (!existsSync(pj)) continue;
    const pkg = JSON.parse(readFileSync(pj, 'utf8'));
    if (pkg.name?.startsWith('@ai-ecoverse/wasm-') && !pkg.private) {
      out.push({ recipe: name, npm: pkg.name });
    }
  }
  return out.sort((a, b) => a.npm.localeCompare(b.npm));
}

function classify(npm, meta) {
  const versions = Object.keys(meta.versions || {}).filter((v) => v !== '0.0.0');
  const latest = meta['dist-tags']?.latest;
  const plain = versions.filter((v) => PLAIN.test(v));
  const packrevs = versions.filter((v) => PACKREV.test(v));
  const targets = [];

  for (const v of plain) {
    const base = v;
    const hasPackrev = packrevs.some((p) => baseOf(p) === base);
    const latestIsPackrevOfPlain =
      latest && PACKREV.test(latest) && baseOf(latest) === base;
    const isLatest = latest === v;

    if (hasPackrev || latestIsPackrevOfPlain) {
      targets.push({
        version: v,
        reason: 'plain-outranks-packrev',
        detail: `plain ${v} outranks ${base}-N; ^${base}-N resolves to ${v}`,
      });
    } else if (isLatest && includeLatestPlain) {
      targets.push({
        version: v,
        reason: 'plain-is-latest',
        detail: `WARNING: ${v} is currently latest — republish as ${v}-1 and retag latest before unpublish`,
      });
    }
  }

  if (latest) {
    for (const v of versions) {
      if (v === latest) continue;
      if (!gt(v, latest)) continue;
      if (targets.some((t) => t.version === v)) continue;
      targets.push({
        version: v,
        reason: 'outranks-latest',
        detail: `${v} > latest ${latest} (semver); loose/^ ranges prefer it over intended latest`,
      });
    }
  }

  targets.sort((a, b) => cmp(a.version, b.version));
  return { npm, latest, versions, targets };
}

/** @param {{ npm: string, reason: string, detail: string, knownVersions: string[] }} entry */
async function classifyRemoveEntirely(entry) {
  const meta = await fetchPkg(entry.npm);
  const live = meta ? Object.keys(meta.versions || {}) : [];
  const latest = meta?.['dist-tags']?.latest;
  const set = new Set([...entry.knownVersions, ...live.filter((v) => v !== '0.0.0')]);
  const targets = [...set]
    .sort(cmp)
    .map((version) => ({
      version,
      reason: entry.reason,
      detail: entry.detail,
      onRegistry: live.includes(version),
    }));
  return {
    npm: entry.npm,
    latest: latest || null,
    versions: live,
    targets,
    removeEntirely: true,
  };
}

function deprecateMessage(reason) {
  if (reason === 'remove-codec-distribution') {
    return 'Removed: @ai-ecoverse must not distribute MPEG codecs; use SLICC ffmpeg (see homescoop packages/ffmpeg)';
  }
  return 'Superseded: plain X.Y.Z outranks X.Y.Z-N under semver; use latest packaging rev (see homescoop docs/versioning.md)';
}

function printShell(rows) {
  console.log(`# homescoop npm cleanup — generated ${new Date().toISOString()}`);
  console.log('# DO NOT run from an agent. Lars: npm login (2FA), then paste.');
  console.log('# Prefer deprecate first; unpublish only within npm’s time window / policy.');
  console.log('# After cleanup, confirm: npm view <pkg> versions');
  console.log('');

  let n = 0;
  for (const row of rows) {
    if (!row.targets.length) continue;
    const tag = row.removeEntirely ? 'REMOVE ENTIRELY' : `latest=${row.latest || '?'}`;
    console.log(`# --- ${row.npm}  (${tag}) ---`);
    for (const t of row.targets) {
      n++;
      const spec = `${row.npm}@${t.version}`;
      const gone = t.onRegistry === false ? ' (not on registry now — still emit for completeness)' : '';
      console.log(`# ${t.reason}: ${t.detail}${gone}`);
      console.log(
        `npm deprecate ${JSON.stringify(spec)} ${JSON.stringify(deprecateMessage(t.reason))}`
      );
      console.log(`npm unpublish ${JSON.stringify(spec)} --force`);
      console.log('');
    }
  }
  console.log(`# ${n} version(s) listed across ${rows.filter((r) => r.targets.length).length} package(s).`);
}

async function main() {
  const rows = [];

  for (const entry of REMOVE_ENTIRELY) {
    rows.push(await classifyRemoveEntirely(entry));
  }

  for (const { npm } of localNpmNames()) {
    if (REMOVE_ENTIRELY.some((e) => e.npm === npm)) continue;
    const meta = await fetchPkg(npm);
    if (!meta) continue;
    rows.push(classify(npm, meta));
  }

  const nonempty = rows.filter((r) => r.targets.length);
  if (asJson) {
    console.log(JSON.stringify(nonempty, null, 2));
    return;
  }
  printShell(nonempty);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
