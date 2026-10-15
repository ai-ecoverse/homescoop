#!/usr/bin/env node
/**
 * Align packages/<name>/package/package.json "version" with recipe.yaml version
 * when the recipe upstream moved (Renovate). Packaging revisions (X-N) that
 * already match the recipe upstream prefix are left alone.
 *
 * New upstreams always get X.Y.Z-1 (never plain X.Y.Z — see docs/versioning.md).
 * Two-part upstreams (2.23) become X.Y.0-1 — npm rejects X.Y-N (e.g. 2.23-1).
 *
 *   node scripts/sync-package-version.mjs zlib
 *   node scripts/sync-package-version.mjs zlib --write
 *   node scripts/sync-package-version.mjs which --assert-publishable
 *   node scripts/sync-package-version.mjs --assert-tarball .homescoop-out/package.tgz
 *
 * --assert-tarball also refuses hard links and symlinks inside the tarball:
 * `npm pack` keeps them, but the registry rejects the publish (E415 "Hard
 * link is not allowed", seen with tic's terminfo aliases in ncurses-utils).
 *
 * Prints the chosen npm version. With --write, updates package.json in place.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { loadAllow, rewriteVersion, summaryLine, versionBase } from './upstream-version-text.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

/** Plain X.Y.Z (no packaging rev) — forbidden on publish; outranks every X.Y.Z-N. */
const PLAIN = /^\d+\.\d+\.\d+$/;
/**
 * npm-publishable packaging rev: X.Y.Z-N (N ≥ 1).
 * Rejects two-part forms like 2.23-1 that npm pack may accept but publish rejects.
 */
const PACKAGING_REV = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-([1-9]\d*)$/;
/** Loose npm core+prerelease (for diagnostics). */
const NPM_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

function isPackagingRev(version) {
  return PACKAGING_REV.test(String(version || ''));
}

function isNpmSemver(version) {
  return NPM_SEMVER.test(String(version || ''));
}

function refuseUnpublishable(label, version) {
  const v = String(version || '');
  if (PLAIN.test(v)) {
    console.error(
      `sync-package-version: refuse plain version ${v} (${label}) — ` +
        `publish X.Y.Z-N only (see docs/versioning.md)`,
    );
    process.exit(2);
  }
  // npm pack is lenient; npm publish requires a real semver (rejects 2.23-1).
  if (!isNpmSemver(v)) {
    console.error(
      `sync-package-version: refuse non-semver version ${v} (${label}) — ` +
        `npm publish requires X.Y.Z[-prerelease]; pad two-part upstreams to X.Y.0-N`,
    );
    process.exit(2);
  }
}

/** Normalize short upstream (668, 2.17) to npm-friendly three-part base. */
function npmify(v) {
  if (/^\d+$/.test(v)) return `${v}.0.0`;
  if (/^\d+\.\d+$/.test(v)) return `${v}.0`;
  return v;
}

/**
 * Entries of a .tgz that are hard links (typeflag '1') or symlinks ('2'),
 * read from the ustar headers so GNU tar and bsdtar listings don't matter.
 * @param {string} tgz
 */
function linkEntries(tgz) {
  const buf = gunzipSync(readFileSync(tgz));
  const out = [];
  let longName = '';
  for (let off = 0; off + 512 <= buf.length; ) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const str = (start, len) => header.subarray(start, start + len).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 12).trim() || '0', 8) || 0;
    const type = String.fromCharCode(header[156] || 48);
    const prefix = str(345, 155);
    const name = longName || (prefix ? `${prefix}/${str(0, 100)}` : str(0, 100));
    const body = Math.ceil(size / 512) * 512;
    if (type === 'L') {
      longName = buf.subarray(off + 512, off + 512 + size).toString('utf8').replace(/\0.*$/s, '');
    } else if (type !== 'x' && type !== 'g') {
      longName = '';
      if (type === '1') out.push(`hard link ${name} -> ${str(157, 100)}`);
      if (type === '2') out.push(`symlink ${name} -> ${str(157, 100)}`);
    }
    off += 512 + body;
  }
  return out;
}

const assertTarballIdx = argv.indexOf('--assert-tarball');
if (assertTarballIdx >= 0) {
  const tgz = argv[assertTarballIdx + 1];
  if (!tgz || tgz.startsWith('-')) {
    console.error('usage: sync-package-version.mjs --assert-tarball <package.tgz>');
    process.exit(2);
  }
  const work = mkdtempSync(join(tmpdir(), 'homescoop-semver-'));
  try {
    mkdirSync(join(work, 'pkg'), { recursive: true });
    const untar = spawnSync('tar', ['-xzf', tgz, '-C', join(work, 'pkg'), 'package/package.json'], {
      encoding: 'utf8',
    });
    if (untar.status !== 0) {
      console.error(untar.stderr || untar.stdout || 'tar failed');
      process.exit(1);
    }
    const pkg = JSON.parse(readFileSync(join(work, 'pkg/package/package.json'), 'utf8'));
    refuseUnpublishable(`tarball ${tgz}`, pkg.version);
    const links = linkEntries(tgz);
    if (links.length > 0) {
      console.error(
        `sync-package-version: ${tgz} has ${links.length} link entr${links.length === 1 ? 'y' : 'ies'}; ` +
          'the npm registry rejects hard links and symlinks (E415). Make them regular files:',
      );
      for (const l of links.slice(0, 20)) console.error(`  ${l}`);
      process.exit(1);
    }
    console.log(pkg.version);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  process.exit(0);
}

const fromIdx = argv.indexOf('--from');
const from = fromIdx >= 0 ? argv[fromIdx + 1] : undefined;
if (fromIdx >= 0 && (!from || from.startsWith('-'))) {
  console.error('usage: sync-package-version.mjs <package> --write --from <previous upstream>');
  process.exit(2);
}
const name = argv.find((a, i) => !a.startsWith('-') && (fromIdx < 0 || i !== fromIdx + 1));
const write = argv.includes('--write');
const assertPublishable = argv.includes('--assert-publishable');

if (!name) {
  console.error(
    'usage: sync-package-version.mjs <package> [--write [--from <previous upstream>]] [--assert-publishable]\n' +
      '       sync-package-version.mjs --assert-tarball <package.tgz>',
  );
  process.exit(2);
}

if (assertPublishable) {
  const pkgPath = join(root, 'packages', name, 'package', 'package.json');
  if (!existsSync(pkgPath)) {
    console.error(`missing ${pkgPath}`);
    process.exit(1);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  refuseUnpublishable(name, pkg.version);
  console.log(pkg.version);
  process.exit(0);
}

const recipeVer = spawnSync(
  'node',
  [join(root, 'scripts/read-recipe.mjs'), name, '--field', 'version'],
  { encoding: 'utf8', cwd: root },
);
if (recipeVer.status !== 0) {
  console.error(recipeVer.stderr || 'read-recipe failed');
  process.exit(1);
}
const builder = spawnSync(
  'node',
  [join(root, 'scripts/read-recipe.mjs'), name, '--field', 'builder'],
  { encoding: 'utf8', cwd: root },
);
if ((builder.stdout || '').trim() === 'retired') {
  console.error(`sync-package-version: ${name} is retired — refuse`);
  process.exit(2);
}
const upstream = recipeVer.stdout.trim();
const pkgPath = join(root, 'packages', name, 'package', 'package.json');
if (!existsSync(pkgPath)) {
  console.error(`missing ${pkgPath}`);
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const current = String(pkg.version || '');

const targetBase = npmify(upstream);
// Same upstream only if current is a valid packaging rev of the npmified base
// (or plain base we will rewrite). Do NOT treat "2.23-1" as same-upstream of
// recipe 2.23 — that form is not npm-publishable.
const sameUpstream =
  isPackagingRev(current) && current.startsWith(`${targetBase}-`);

let next = current;
if (!sameUpstream) {
  // Recipe moved, or current is non-semver / two-part-N / plain: first packaging rev.
  const revMatch = String(current).match(/-(\d+)$/);
  const rev =
    revMatch && (current.startsWith(`${upstream}-`) || current.startsWith(`${targetBase}-`))
      ? revMatch[1]
      : '1';
  next = `${targetBase}-${rev}`;
} else if (PLAIN.test(current)) {
  next = `${targetBase}-1`;
}

refuseUnpublishable('computed', next);

function setJsonString(raw, re, value) {
  return raw.replace(re, (m, head) => `${head}${JSON.stringify(value)}`);
}

function logRewrite(file, offsetLine, r) {
  for (const c of r.changes) {
    console.error(`sync-package-version: ${name} ${file}:${offsetLine + c.line - 1} ${c.from} → ${c.to}: ${c.excerpt}`);
  }
  for (const k of r.kept) {
    console.error(`sync-package-version: ${name} ${file}:${offsetLine + k.line - 1} kept ${k.from} (${k.reason}): ${k.excerpt}`);
  }
}

const previous = from ?? String(pkg.homescoop?.upstream ?? versionBase(current));
const rewriteText = write && previous !== upstream;
if (write && (next !== current || rewriteText)) {
  const raw = readFileSync(pkgPath, 'utf8');
  const want = JSON.parse(raw);
  let out = raw;
  if (next !== current) {
    want.version = next;
    if (!want.homescoop) want.homescoop = {};
    want.homescoop.upstream = upstream;
    want.homescoop.recipe = name;
    out = setJsonString(out, /^(\s*"version"\s*:\s*)"(?:[^"\\]|\\.)*"/m, next);
    out = setJsonString(out, /("upstream"\s*:\s*)"(?:[^"\\]|\\.)*"/, upstream);
    out = setJsonString(out, /("recipe"\s*:\s*)"(?:[^"\\]|\\.)*"/, name);
    console.error(`sync-package-version: ${name} ${current} → ${next}`);
  }
  if (rewriteText) {
    const allow = loadAllow();
    const ctx = { allow, name };
    if (typeof want.description === 'string') {
      const r = rewriteVersion(want.description, previous, upstream, ctx);
      logRewrite('package/package.json description', 1, r);
      if (r.changes.length) {
        want.description = r.text;
        out = setJsonString(out, /^(\s*"description"\s*:\s*)"(?:[^"\\]|\\.)*"/m, r.text);
      }
    }
    const recipePath = join(root, 'packages', name, 'recipe.yaml');
    const recipeRaw = readFileSync(recipePath, 'utf8');
    const sum = summaryLine(recipeRaw);
    if (sum) {
      const r = rewriteVersion(sum.text, previous, upstream, ctx);
      logRewrite('recipe.yaml', recipeRaw.slice(0, sum.index).split('\n').length, r);
      if (r.changes.length) {
        writeFileSync(recipePath, recipeRaw.slice(0, sum.index) + r.text + recipeRaw.slice(sum.index + sum.text.length));
      }
    }
    const readmePath = join(root, 'packages', name, 'package', 'README.md');
    if (existsSync(readmePath)) {
      const r = rewriteVersion(readFileSync(readmePath, 'utf8'), previous, upstream, ctx);
      logRewrite('package/README.md', 1, r);
      if (r.changes.length) writeFileSync(readmePath, r.text);
    }
  }
  let same = false;
  try { same = JSON.stringify(JSON.parse(out)) === JSON.stringify(want); } catch { same = false; }
  writeFileSync(pkgPath, same ? out : `${JSON.stringify(want, null, 2)}\n`);
}

console.log(next);
