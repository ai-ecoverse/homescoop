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
