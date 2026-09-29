#!/usr/bin/env node
/**
 * Align packages/<name>/package/package.json "version" with recipe.yaml version
 * when the recipe upstream moved (Renovate). Packaging revisions (X-N) that
 * already match the recipe upstream prefix are left alone.
 *
 * New upstreams always get X.Y.Z-1 (never plain X.Y.Z — see docs/versioning.md).
 *
 *   node scripts/sync-package-version.mjs zlib
 *   node scripts/sync-package-version.mjs zlib --write
 *
 * Prints the chosen npm version. With --write, updates package.json in place.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2];
const write = process.argv.includes('--write');
const assertPublishable = process.argv.includes('--assert-publishable');

/** Plain X.Y.Z (no packaging rev) — forbidden on publish; outranks every X.Y.Z-N. */
const PLAIN = /^\d+\.\d+\.\d+$/;

function refusePlain(label, version) {
  if (!PLAIN.test(String(version || ''))) return;
  console.error(
    `sync-package-version: refuse plain version ${version} (${label}) — ` +
      `publish X.Y.Z-N only (see docs/versioning.md)`
  );
  process.exit(2);
}

if (!name || name.startsWith('-')) {
  console.error(
    'usage: sync-package-version.mjs <package> [--write] [--assert-publishable]'
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
  refusePlain(name, pkg.version);
  console.log(pkg.version);
  process.exit(0);
}

const recipeVer = spawnSync(
  'node',
  [join(root, 'scripts/read-recipe.mjs'), name, '--field', 'version'],
  { encoding: 'utf8', cwd: root }
);
if (recipeVer.status !== 0) {
  console.error(recipeVer.stderr || 'read-recipe failed');
  process.exit(1);
}
const builder = spawnSync(
  'node',
  [join(root, 'scripts/read-recipe.mjs'), name, '--field', 'builder'],
  { encoding: 'utf8', cwd: root }
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

/** Normalize short upstream (668, 2.17) to npm-friendly semver. */
function npmify(v) {
  if (/^\d+$/.test(v)) return `${v}.0.0`;
  if (/^\d+\.\d+$/.test(v)) return `${v}.0`;
  return v;
}

const targetBase = npmify(upstream);
// current is packaging rev of same upstream? e.g. 1.3.1-2 vs recipe 1.3.1
const sameUpstream =
  current === targetBase ||
  current === upstream ||
  current.startsWith(`${targetBase}-`) ||
  current.startsWith(`${upstream}-`) ||
  current.startsWith(`${upstream}.`);

let next = current;
if (!sameUpstream) {
  // Recipe moved (Renovate): first packaging rev is always X.Y.Z-1 — never
  // plain X.Y.Z (plain outranks every -N under semver caret ranges).
  next = `${targetBase}-1`;
} else if (current === upstream && current !== targetBase) {
  // Two-component upstream (5.3, 3.12) is not valid npm semver — use X.Y.0-1.
  next = `${targetBase}-1`;
} else if (PLAIN.test(current)) {
  // Local package.json still on a forbidden plain version — bump to -1.
  next = `${targetBase}-1`;
}

refusePlain('computed', next);

if (write && next !== current) {
  pkg.version = next;
  if (!pkg.homescoop) pkg.homescoop = {};
  pkg.homescoop.upstream = upstream;
  pkg.homescoop.recipe = name;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.error(`sync-package-version: ${name} ${current} → ${next}`);
}

console.log(next);
