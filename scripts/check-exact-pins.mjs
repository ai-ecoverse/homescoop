#!/usr/bin/env node
/**
 * Every @ai-ecoverse/* dependency of a homescoop package is an exact version.
 *
 *   node scripts/check-exact-pins.mjs                 # all packages/<name>/package
 *   node scripts/check-exact-pins.mjs uv-shim git     # these recipes only
 *   node scripts/check-exact-pins.mjs --file path/to/package.json
 *
 * Checks dependencies, peerDependencies and optionalDependencies. A range
 * (^, ~, >=, x, *, ||), a dist-tag (latest), a workspace:/npm:/file:/git spec
 * all fail: `pnpm add -g` / `npm i -g` would resolve the newest matching
 * version, not the one this package was certified with, and a global add
 * cannot override transitive versions. Pin the exact version that is `latest`
 * on npm and certified (docs/versioning.md).
 *
 * PENDING lists packages whose packaging-only re-release with exact pins is
 * still in flight. They are reported, not failed; once a package is exact it
 * must leave PENDING (the check fails on a stale entry).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCOPE = '@ai-ecoverse/';
const FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];
/** npm semver, exact: X.Y.Z[-prerelease][+build], no operators. */
export const EXACT =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** Recipes (packages/<name>) still waiting for their exact-pin re-release. */
export const PENDING = new Set([
  'git',
  'py-contourpy',
  'py-matplotlib',
  'py-pandas',
  'py-scipy',
  'wasix-autoconf',
  'wasix-automake',
  'wasm-clang',
  'wasm-emscripten',
]);

/**
 * @param {Record<string, any>} pkg parsed package.json
 * @returns {string[]} one message per non-exact @ai-ecoverse entry
 */
export function pinErrors(pkg) {
  const errors = [];
  for (const field of FIELDS) {
    for (const [dep, spec] of Object.entries(pkg[field] || {})) {
      if (!dep.startsWith(SCOPE)) continue;
      if (typeof spec !== 'string' || !EXACT.test(spec.trim()) || spec !== spec.trim()) {
        errors.push(`${field}["${dep}"] = ${JSON.stringify(spec)} is not an exact version`);
      }
    }
  }
  return errors;
}

function main() {
  const args = process.argv.slice(2);
  /** @type {{ label: string, path: string, recipe: string|null }[]} */
  const targets = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file') {
      const path = args[++i];
      if (!path) {
        console.error('usage: check-exact-pins.mjs [--file package.json] [<package>...]');
        process.exit(2);
      }
      targets.push({ label: path, path, recipe: null });
    } else if (args[i].startsWith('-')) {
      console.error(`unknown option ${args[i]}`);
      process.exit(2);
    } else {
      targets.push({ label: args[i], path: join(root, 'packages', args[i], 'package', 'package.json'), recipe: args[i] });
    }
  }
  const all = targets.length === 0;
  if (all) {
    for (const name of readdirSync(join(root, 'packages')).sort()) {
      const path = join(root, 'packages', name, 'package', 'package.json');
      if (existsSync(path)) targets.push({ label: name, path, recipe: name });
    }
  }

  let failed = false;
  let checked = 0;
  for (const t of targets) {
    if (!existsSync(t.path)) {
      console.error(`missing ${t.path}`);
      failed = true;
      continue;
    }
    const pkg = JSON.parse(readFileSync(t.path, 'utf8'));
    const errors = pinErrors(pkg);
    checked++;
    const pending = t.recipe !== null && PENDING.has(t.recipe);
    if (errors.length && pending) {
      console.log(`pending ${t.label} (${pkg.name}@${pkg.version}): exact-pin re-release in flight`);
      for (const e of errors) console.log(`  - ${e}`);
    } else if (errors.length) {
      failed = true;
      console.error(`${relative(root, t.path)} (${pkg.name}@${pkg.version}):`);
      for (const e of errors) console.error(`  - ${e}`);
    } else if (pending) {
      failed = true;
      console.error(`${t.label}: all @ai-ecoverse deps are exact; remove it from PENDING in scripts/check-exact-pins.mjs`);
    }
  }
  if (all) {
    for (const name of PENDING) {
      if (!existsSync(join(root, 'packages', name, 'package', 'package.json'))) {
        failed = true;
        console.error(`PENDING names unknown package ${name}`);
      }
    }
  }
  if (failed) {
    console.error('check-exact-pins: pin every @ai-ecoverse/* dependency to an exact, certified version (docs/versioning.md)');
    process.exit(1);
  }
  console.log(`check-exact-pins: ${checked} package.json ok`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
