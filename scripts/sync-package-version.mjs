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
 * Prints the chosen npm version. With --write, updates package.json in place.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

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
    console.log(pkg.version);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  process.exit(0);
}

const name = argv.find((a) => !a.startsWith('-'));
const write = argv.includes('--write');
const assertPublishable = argv.includes('--assert-publishable');

if (!name) {
  console.error(
    'usage: sync-package-version.mjs <package> [--write] [--assert-publishable]\n' +
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

if (write && next !== current) {
  pkg.version = next;
  if (!pkg.homescoop) pkg.homescoop = {};
  pkg.homescoop.upstream = upstream;
  pkg.homescoop.recipe = name;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.error(`sync-package-version: ${name} ${current} → ${next}`);
}

console.log(next);
