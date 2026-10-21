import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const packages = join(root, 'packages');

function recipeDocs(pkg) {
  const dir = join(packages, pkg);
  return readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => join(dir, f));
}

export function missingTools(pkg, text) {
  const paths = new Set([...text.matchAll(/`(tools\/[^`\s]+)`/g)].map((m) => m[1]));
  return [...paths].filter((p) => !existsSync(join(packages, pkg, p))).sort();
}

export function foreignSoabi(abi, text) {
  const want = `cpython-${abi.replace(/^cp/, '')}`;
  return [...new Set([...text.matchAll(/cpython-3\d+/g)].map((m) => m[0]))].filter((t) => t !== want).sort();
}

function pythonAbi(pkg) {
  const file = join(packages, pkg, 'package', 'package.json');
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')).slicc?.python?.requires?.abi;
}

const recipes = readdirSync(packages, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();

test('recipe docs name only tools/ paths the recipe has (homescoop#1178)', () => {
  const bad = [];
  for (const pkg of recipes) {
    for (const doc of recipeDocs(pkg)) {
      for (const p of missingTools(pkg, readFileSync(doc, 'utf8'))) bad.push(`${pkg}/${doc.split('/').pop()}: ${p}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('a py-* recipe doc names only its own SOABI (homescoop#1178)', () => {
  const bad = [];
  let checked = 0;
  for (const pkg of recipes) {
    const abi = pythonAbi(pkg);
    if (!abi) continue;
    for (const doc of recipeDocs(pkg)) {
      checked++;
      for (const t of foreignSoabi(abi, readFileSync(doc, 'utf8'))) bad.push(`${pkg}/${doc.split('/').pop()}: ${t} (abi ${abi})`);
    }
  }
  assert.ok(checked > 0, 'at least one py-* recipe doc checked');
  assert.deepEqual(bad, []);
});

test('the checks catch py-numpy 2.5.4-3\'s PRESTAGE.md text', () => {
  const old = 'Rebuild: `tools/rebuild-with-openblas.sh`\n- `PYTHONPATH=tools/sitecustomize.py` dir\n1. SOABI `cpython-314-wasm32-wasix` (no macosx/darwin).\n`tools/build-openblas.sh`';
  assert.deepEqual(missingTools('py-numpy', old), ['tools/rebuild-with-openblas.sh']);
  assert.deepEqual(foreignSoabi('cp315', old), ['cpython-314']);
  assert.deepEqual(foreignSoabi('cp315', 'cpython-315-wasm32-wasix'), []);
});

export function foreignSysroot(buildSh, recipeYaml) {
  const pin = /^export HOMESCOOP_WASIX_SYSROOT_VERSION=(\S+)$/m.exec(buildSh)?.[1];
  if (!pin) return null;
  return [...new Set([...recipeYaml.matchAll(/wasix-sysroot (2025\.\d+\.\d+-\d+)/g)].map((m) => m[1]))].filter((v) => v !== pin).sort();
}

test('recipe.yaml names only the wasix-sysroot its build.sh pins (homescoop#1426)', () => {
  const bad = [];
  let checked = 0;
  for (const pkg of recipes) {
    const build = join(packages, pkg, 'build.sh');
    const recipe = join(packages, pkg, 'recipe.yaml');
    if (!existsSync(build) || !existsSync(recipe)) continue;
    const foreign = foreignSysroot(readFileSync(build, 'utf8'), readFileSync(recipe, 'utf8'));
    if (foreign === null) continue;
    checked++;
    for (const v of foreign) bad.push(`${pkg}/recipe.yaml: wasix-sysroot ${v}, build.sh pins another`);
  }
  assert.ok(checked > 0, 'at least one recipe with a sysroot pin checked');
  assert.deepEqual(bad, []);
});

test('the sysroot check catches wasix-openssh 10.6.0-12\'s notes', () => {
  const build = 'export HOMESCOOP_WASIX_SYSROOT_VERSION=2025.9.30-39\n';
  const notes = 'notes: |\n    Built with wasixcc on wasix-sysroot 2025.9.30-34 (select/pselect\n';
  assert.deepEqual(foreignSysroot(build, notes), ['2025.9.30-34']);
  assert.deepEqual(foreignSysroot(build, notes.replace('-34', '-39')), []);
  assert.equal(foreignSysroot('', notes), null);
});
