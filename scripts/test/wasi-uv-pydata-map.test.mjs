/**
 * Keeps packages/wasi-uv/homescoop-pydata-map.json aligned with native py-*
 * packages (those that declare slicc.python.requires.abi) and with
 * wasix-python's `_slicc_pip.HOMESCOOP_PIP_NATIVE` (same PyPI keys).
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const mapPath = join(root, 'packages/wasi-uv/homescoop-pydata-map.json');
const pipMod = join(root, 'packages/wasix-python/stdlib/_slicc_pip.py');

/** PyPI distribution name for a homescoop py-* recipe dir. */
function pypiName(dir) {
  const bare = dir.replace(/^py-/, '');
  if (bare === 'pillow') return 'pillow';
  if (bare === 'python-dateutil') return 'python-dateutil';
  return bare;
}

function nativePyDirs() {
  const packages = join(root, 'packages');
  return readdirSync(packages)
    .filter((d) => d.startsWith('py-'))
    .filter((d) => {
      const pj = join(packages, d, 'package/package.json');
      let data;
      try {
        data = JSON.parse(readFileSync(pj, 'utf8'));
      } catch {
        return false;
      }
      const abi = data?.slicc?.python?.requires?.abi;
      return typeof abi === 'string' && /^cp\d+$/.test(abi);
    })
    .sort();
}

test('homescoop-pydata-map.json lists every ABI-native py-* under its PyPI name', () => {
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  assert.equal(map.version, 1);
  assert.equal(map.catalog.id, 'pydata');
  assert.match(map.messageTemplate, /\{pypi\}/);
  assert.match(map.messageTemplate, /\{npm\}/);

  const byPypi = new Map(Object.entries(map.packages));
  const natives = nativePyDirs();
  assert.ok(natives.length >= 7, `expected native py-* dirs, got ${natives.join(',')}`);

  for (const dir of natives) {
    const name = pypiName(dir);
    const entry = byPypi.get(name);
    assert.ok(entry, `map missing PyPI key "${name}" for ${dir}`);
    assert.equal(entry.kind, 'native');
    assert.equal(entry.npm, `@ai-ecoverse/${dir}`);
  }

  for (const [name, entry] of byPypi) {
    assert.equal(entry.kind, 'native', name);
    const dir = entry.npm.replace('@ai-ecoverse/', '');
    assert.ok(natives.includes(dir), `map has ${name} → ${entry.npm} but ${dir} is not an ABI-native py-*`);
  }
});

test('pydata catalog members point at catalog id pydata; matplotlib deps do not', () => {
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  for (const name of ['numpy', 'scipy', 'pandas', 'matplotlib']) {
    assert.equal(map.packages[name].catalog, 'pydata', name);
  }
  for (const name of ['pillow', 'contourpy', 'kiwisolver']) {
    assert.equal(map.packages[name].catalog, null, name);
  }
});

test('wasix-python _slicc_pip.HOMESCOOP_PIP_NATIVE matches the shared map keys/npm/catalog', () => {
  assert.ok(existsSync(pipMod), `_slicc_pip.py missing at ${pipMod}`);
  const r = spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(root, 'packages/wasix-python/stdlib'))})
import _slicc_pip as g
print(json.dumps({k: {"npm": v["npm"], "catalog": v["catalog"]} for k, v in g.HOMESCOOP_PIP_NATIVE.items()}))
`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const pip = JSON.parse(r.stdout.trim());
  const map = JSON.parse(readFileSync(mapPath, 'utf8')).packages;
  assert.deepEqual(Object.keys(pip).sort(), Object.keys(map).sort(), 'PyPI key sets differ');
  for (const [name, entry] of Object.entries(map)) {
    assert.deepEqual(pip[name], { npm: entry.npm, catalog: entry.catalog }, name);
  }
});

test('FAILFAST.md and README point at the map / design when present', () => {
  const failfastPath = join(root, 'packages/wasi-uv/FAILFAST.md');
  const readmePath = join(root, 'packages/wasi-uv/package/README.md');
  if (!existsSync(failfastPath)) {
    // Pip-only PR may land the JSON before uv's design doc; skip soft docs check.
    return;
  }
  const failfast = readFileSync(failfastPath, 'utf8');
  assert.match(failfast, /homescoop-pydata-map\.json/);
  const readme = readFileSync(readmePath, 'utf8');
  assert.match(readme, /FAILFAST\.md|homescoop-pydata-map/);
  assert.match(readme, /pydata|Python data tools/);
});
