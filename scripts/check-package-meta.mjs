#!/usr/bin/env node
/**
 * Gate package metadata before npm pack/publish.
 *
 *   node scripts/check-package-meta.mjs <package>
 *
 * Checks:
 *   - recipe about.license is a real SPDX id (not SEE_UPSTREAM / empty)
 *   - package.json license matches the recipe
 *   - package/LICENSE exists and is non-empty
 *   - package.json files includes LICENSE
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2];
if (!name || name.startsWith('-')) {
  console.error('usage: check-package-meta.mjs <package>');
  process.exit(2);
}

const recipePath = join(root, 'packages', name, 'recipe.yaml');
const pkgPath = join(root, 'packages', name, 'package', 'package.json');
const licPath = join(root, 'packages', name, 'package', 'LICENSE');

if (!existsSync(recipePath)) {
  console.error(`missing ${recipePath}`);
  process.exit(1);
}
if (!existsSync(pkgPath)) {
  console.error(`missing ${pkgPath}`);
  process.exit(1);
}

const recipe = JSON.parse(
  spawnSync(
    process.execPath,
    [join(root, 'scripts/read-recipe.mjs'), name, '--json'],
    { encoding: 'utf8', cwd: root }
  ).stdout
);
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const about = recipe.about || {};
const recipeLic = String(about.license || '').trim();
const pkgLic = String(pkg.license || '').trim();
const errors = [];

if (!recipeLic || recipeLic === 'SEE_UPSTREAM') {
  errors.push(`recipe about.license must be SPDX (got ${recipeLic || '(empty)'})`);
}
if (!pkgLic) {
  errors.push('package.json license missing');
} else if (recipeLic && pkgLic !== recipeLic) {
  errors.push(`package.json license "${pkgLic}" != recipe "${recipeLic}"`);
}
if (!existsSync(licPath) || statSync(licPath).size < 32) {
  errors.push('package/LICENSE missing or too small (stage upstream COPYING/LICENSE)');
}
const files = pkg.files;
if (!Array.isArray(files) || !files.includes('LICENSE')) {
  errors.push('package.json files[] must include "LICENSE"');
}

if (errors.length) {
  console.error(`check-package-meta (${name}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`${name}: license ${pkgLic} ok`);
