#!/usr/bin/env node
/**
 * Align packages/<name>/package/package.json "version" with recipe.yaml version
 * when the recipe upstream moved (Renovate). Packaging revisions (X-N) that
 * already match the recipe upstream prefix are left alone.
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

if (!name || name.startsWith('-')) {
  console.error('usage: sync-package-version.mjs <package> [--write]');
  process.exit(2);
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
const upstream = recipeVer.stdout.trim();
const pkgPath = join(root, 'packages', name, 'package', 'package.json');
if (!existsSync(pkgPath)) {
  console.error(`missing ${pkgPath}`);
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const current = String(pkg.version || '');

/** Normalize two-component upstream (2.17) to npm-friendly 2.17.0 */
function npmify(v) {
  if (/^\d+\.\d+$/.test(v)) return `${v}.0`;
  return v;
}

const targetBase = npmify(upstream);
// current is packaging rev of same upstream? e.g. 1.3.1-2 vs recipe 1.3.1
const sameUpstream =
  current === targetBase ||
  current === upstream ||
  current.startsWith(`${targetBase}-`) ||
  current.startsWith(`${upstream}-`);

let next = current;
if (!sameUpstream) {
  // Recipe moved (Renovate): publish as the new upstream (npmified).
  next = targetBase;
}

if (write && next !== current) {
  pkg.version = next;
  if (!pkg.homescoop) pkg.homescoop = {};
  pkg.homescoop.upstream = upstream;
  pkg.homescoop.recipe = name;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.error(`sync-package-version: ${name} ${current} → ${next}`);
}

console.log(next);
