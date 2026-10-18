#!/usr/bin/env node
/**
 * A built package tarball against npm (#402, #493, #497).
 *
 *   node scripts/npm-parity.mjs <package.tgz> [--tag <npm-tag>] [--drift warn|fail] [--json <out.json>]
 *
 * --tag is the recipe's npm-tag (scripts/npm-tag.mjs; default latest): the
 * channel ladder-build publishes the version under. Versions under other
 * dist-tags never count.
 *
 * - behind: the version sorts below the version under its tag: the build is
 *   behind main. Always fails; ladder-build publishes with --tag <tag>, so
 *   an older version must never ship.
 * - same: the version is on npm with the same entries (path, type, mode,
 *   link, content): nothing to publish.
 * - drift: the version is on npm with different entries, so these bytes
 *   would never ship. Fails with --drift fail (bump the packaging revision
 *   or revert), warns with --drift warn.
 * - new: the version is not on npm and sorts above the version under its
 *   tag (or the tag, or the package, is not on npm yet): a new release.
 */
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readTarball } from './diff-published.mjs';
import { compareTarballs, describe } from './tarball-parity.mjs';
import { DEFAULT_TAG, cliTagProblem } from './npm-tag.mjs';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function compareVersions(a, b) {
  const pa = SEMVER.exec(a);
  const pb = SEMVER.exec(b);
  if (!pa || !pb) throw new Error(`not a semver version: ${!pa ? a : b}`);
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return Math.sign(d);
  }
  if (!pa[4] && !pb[4]) return 0;
  if (!pa[4]) return 1;
  if (!pb[4]) return -1;
  const xa = pa[4].split('.');
  const xb = pb[4].split('.');
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1;
    if (xb[i] === undefined) return 1;
    const na = /^\d+$/.test(xa[i]);
    const nb = /^\d+$/.test(xb[i]);
    if (na && nb) {
      const d = Number(xa[i]) - Number(xb[i]);
      if (d) return Math.sign(d);
    } else if (na !== nb) return na ? -1 : 1;
    else if (xa[i] !== xb[i]) return xa[i] < xb[i] ? -1 : 1;
  }
  return 0;
}

export function nextRevision(version) {
  const m = /^(\d+\.\d+\.\d+)-(\d+)$/.exec(version);
  return m ? `${m[1]}-${Number(m[2]) + 1}` : null;
}

export function tagged(registry, tag = DEFAULT_TAG) {
  if (!registry) return null;
  if (tag === DEFAULT_TAG) return registry.latest ?? registry.tags?.latest ?? null;
  return registry.tags?.[tag] ?? null;
}

export function classify(version, registry, tag = DEFAULT_TAG) {
  if (!registry) return { kind: 'new', why: 'not on npm' };
  const latest = tagged(registry, tag);
  const published = registry.versions.includes(version);
  if (latest && compareVersions(version, latest) < 0) return { kind: 'behind', latest, published };
  if (published) return { kind: 'published', latest };
  return { kind: 'new', latest, why: latest ? `not on npm, above ${tag} ${latest}` : `not on npm, and npm has no ${tag}` };
}

function npm(args) {
  const bin = process.env.HOMESCOOP_NPM || 'npm';
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    last = spawnSync(bin, args, { encoding: 'utf8' });
    if (last.status === 0) return last;
    if (/E404|404 Not Found|is not in this registry/.test(`${last.stdout}${last.stderr}`)) return last;
    if (attempt < 3) spawnSync('sleep', [String(attempt * Number(process.env.HOMESCOOP_NPM_RETRY_S ?? 5))]);
  }
  return last;
}

export function registryOf(name) {
  const r = npm(['view', name, 'versions', 'dist-tags', '--json']);
  if (r.status !== 0) {
    if (/E404|404 Not Found|is not in this registry/.test(`${r.stdout}${r.stderr}`)) return null;
    throw new Error(`npm view ${name} failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}`);
  }
  const j = JSON.parse(r.stdout);
  const versions = [j.versions ?? []].flat();
  const tags = j['dist-tags'] && typeof j['dist-tags'] === 'object' ? j['dist-tags'] : {};
  return { versions, latest: tags.latest || null, tags };
}

export function packPublished(spec) {
  const dir = mkdtempSync(join(tmpdir(), 'homescoop-npm-parity-'));
  try {
    const r = npm(['pack', spec, '--pack-destination', dir, '--silent']);
    if (r.status !== 0) throw new Error(`npm pack ${spec} failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}`);
    const tgz = readdirSync(dir).find((f) => f.endsWith('.tgz'));
    if (!tgz) throw new Error(`npm pack ${spec}: no tarball`);
    return readFileSync(join(dir, tgz));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function npmParity(tgz, { drift = 'warn', tag = DEFAULT_TAG, registry = registryOf, pack = packPublished } = {}) {
  const tagError = cliTagProblem(tag);
  if (tagError) throw new Error(tagError);
  const entry = readTarball(tgz).get('package/package.json');
  if (!entry) throw new Error('the tarball has no package/package.json');
  const { name, version } = JSON.parse(entry.data.toString('utf8'));
  const id = `${name}@${version}`;
  const reg = registry(name);
  if (tag !== DEFAULT_TAG && reg && !tagged(reg, DEFAULT_TAG)) {
    return { name, version, tag, latest: null, drift, verdict: 'no-latest', level: 'error', message: `${id}: npm has no latest for ${name}, and a first publish under --tag ${tag} would make it latest too: publish the name under latest first` };
  }
  if (tag !== DEFAULT_TAG && !reg) {
    return { name, version, tag, latest: null, drift, verdict: 'no-latest', level: 'error', message: `${id}: ${name} isn't on npm, and a first publish under --tag ${tag} would make it latest too: publish the name under latest first` };
  }
  const c = classify(version, reg, tag);
  const out = { name, version, tag, latest: c.latest ?? null, drift };
  if (c.kind === 'behind') {
    return {
      ...out,
      verdict: 'behind',
      level: 'error',
      message: `${id} sorts below npm ${tag} ${c.latest}${c.published ? ' (and is already on npm)' : ''}: this build is behind main. Merge main into the branch; ladder-build publishes with --tag ${tag}, so an older version must never ship`,
    };
  }
  if (c.kind === 'new') return { ...out, verdict: 'new', level: 'notice', message: `${id}: a new release (${c.why})` };
  const res = compareTarballs(pack(id), tgz, { labels: ['npm', 'build'] });
  out.sha256 = res.sha256;
  out.diffs = res.diffs;
  if (res.same) {
    return {
      ...out,
      verdict: 'same',
      level: 'notice',
      message: `${id} is on npm with the same contents${res.bytesSame ? ' (byte-identical tarball)' : ''}; nothing to publish`,
    };
  }
  const next = nextRevision(version);
  return {
    ...out,
    verdict: 'drift',
    level: drift === 'fail' ? 'error' : 'warning',
    message: `${id} is on npm with different contents (${res.diffs.length} entr${res.diffs.length === 1 ? 'y' : 'ies'}: ${res.diffs
      .slice(0, 5)
      .map((d) => d.path.replace(/^package\//, ''))
      .join(', ')}${res.diffs.length > 5 ? ', …' : ''}), so this build would never ship: ${next ? `bump the packaging revision to ${next}` : 'bump the packaging revision'} or revert the change`,
    details: describe(res, { max: 50 }),
  };
}

function main() {
  const args = process.argv.slice(2);
  const at = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args.splice(i, 2)[1] : '';
  };
  const drift = at('--drift') || 'warn';
  const json = at('--json');
  const tag = at('--tag') || DEFAULT_TAG;
  if (args.length !== 1 || !['warn', 'fail'].includes(drift)) {
    console.error('usage: npm-parity.mjs <package.tgz> [--tag <npm-tag>] [--drift warn|fail] [--json <out.json>]');
    return 2;
  }
  let r;
  try {
    r = npmParity(readFileSync(args[0]), { drift, tag });
  } catch (err) {
    r = { verdict: 'error', level: 'error', message: `npm-parity: ${err.message}` };
  }
  console.log(`::${r.level}::${r.message}`);
  for (const line of r.details || []) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- npm-parity ${r.verdict}: ${r.message}\n`);
  if (json) {
    mkdirSync(dirname(resolve(json)), { recursive: true });
    writeFileSync(json, `${JSON.stringify(r, null, 2)}\n`);
  }
  const code = r.level === 'error' ? 1 : 0;
  const what = `${r.verdict}${r.name ? ` ${r.name}@${r.version}` : ''}`;
  console.log(code === 0 ? `npm-parity: PASS ${what}` : `npm-parity: FAIL ${what}`);
  return code;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exit(main());
