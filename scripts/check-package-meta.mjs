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
 *   - a .wasm that imports slicc.cred_get / cred_set / groups_get / groups_set
 *     (wasix-sysroot >= 2025.9.30-20: user ids from slicc-kernel, no fallback)
 *     needs engines["slicc-kernel"] >= 1.44.0
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
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
// homescoop's own Apache-2.0 text is not an upstream licence (#123).
const rootLic = join(root, 'LICENSE');
if (
  existsSync(licPath) && existsSync(rootLic) && !/\bApache-2\.0\b/.test(recipeLic) &&
  readFileSync(licPath, 'utf8') === readFileSync(rootLic, 'utf8')
) {
  errors.push(`package/LICENSE is homescoop's Apache-2.0 text, not the ${recipeLic} upstream licence`);
}
// The committed file too: build.sh usually stages the upstream licence over
// it, so the check above passes, but a packaging-only path ships the
// committed copy (tar 1.35.0-3, diffutils 3.12.0, patch 2.8.0 did).
if (existsSync(rootLic) && !/\bApache-2\.0\b/.test(recipeLic)) {
  const tracked = spawnSync('git', ['-C', root, 'show', `HEAD:packages/${name}/package/LICENSE`], {
    encoding: 'utf8',
  });
  if (tracked.status === 0 && tracked.stdout === readFileSync(rootLic, 'utf8')) {
    errors.push(
      `committed packages/${name}/package/LICENSE is homescoop's Apache-2.0 text; commit the ${recipeLic} upstream licence`,
    );
  }
}
const files = pkg.files;
if (!Array.isArray(files) || !files.includes('LICENSE')) {
  errors.push('package.json files[] must include "LICENSE"');
}

// wasix-sysroot -20 asks slicc-kernel for user ids (slicc.cred_*), with no
// fallback: a binary that does needs a kernel with users (K1, 1.44.0).
const CRED = new Set(['cred_get', 'cred_set', 'groups_get', 'groups_set']);
function wasmImports(buf) {
  if (buf.length < 8 || buf.readUInt32LE(0) !== 0x6d736100) return [];
  let p = 8;
  const u32 = () => { let r = 0, s = 0, b; do { b = buf[p++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return r >>> 0; };
  const str = () => { const n = u32(); const s = buf.toString('utf8', p, p + n); p += n; return s; };
  const limits = () => { const f = u32(); u32(); if (f & 1) u32(); };
  const out = [];
  while (p < buf.length) {
    const id = buf[p++]; const size = u32(); const end = p + size;
    if (id === 2) {
      for (let n = u32(); n > 0; n--) {
        const module = str(); const field = str(); const kind = buf[p++];
        if (kind === 0) u32(); else if (kind === 1) { p++; limits(); } else if (kind === 2) limits();
        else if (kind === 3) p += 2; else if (kind === 4) { p++; u32(); }
        out.push([module, field]);
      }
      return out;
    }
    p = end;
  }
  return out;
}
function* wasmFiles(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const f = join(dir, e.name);
    if (e.isDirectory()) yield* wasmFiles(f);
    else if (e.isFile() && (e.name.endsWith('.wasm') || /\.so$/.test(e.name))) yield f;
  }
}
const credUsers = [];
for (const f of wasmFiles(join(root, 'packages', name, 'package'))) {
  if (wasmImports(readFileSync(f)).some(([m, n]) => m === 'slicc' && CRED.has(n))) credUsers.push(f);
}
if (credUsers.length) {
  const want = [1, 44, 0];
  const floor = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(String(pkg.engines?.['slicc-kernel'] ?? '').trim());
  const ok = floor && floor.slice(1).map(Number).reduce((c, v, i) => c || (v !== want[i] ? Math.sign(v - want[i]) : 0), 0) >= 0;
  if (!ok) {
    errors.push(`${credUsers.length} binaries ask slicc-kernel for user ids (slicc.cred_*, wasix-sysroot >= -20, no fallback): package.json needs "engines": { "slicc-kernel": ">=1.44.0" } or later (got ${JSON.stringify(pkg.engines?.['slicc-kernel'] ?? null)})`);
  }
}

if (errors.length) {
  console.error(`check-package-meta (${name}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`${name}: license ${pkgLic} ok`);
