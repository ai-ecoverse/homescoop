/**
 * Host unit tests for stdlib/_slicc_pip.py (no WASIX runtime).
 *   node --test packages/wasix-python/test/pip-guard.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const stdlib = join(here, '..', 'stdlib');

function py(code) {
  const r = spawnSync('python3', ['-c', code], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: stdlib },
  });
  if (r.status !== 0) {
    throw new Error(`python3 failed (rc ${r.status}):\n${r.stderr || r.stdout}`);
  }
  return (r.stdout || '').trimEnd();
}

test('_slicc_pip: map covers the native pydata set and leaves pure-Python alone', () => {
  const out = py(`
import json, _slicc_pip as g
print(json.dumps({
  "numpy": g.lookup("NumPy"),
  "scipy": g.lookup("scipy"),
  "pandas": g.lookup("pandas"),
  "matplotlib": g.lookup("matplotlib"),
  "pillow": g.lookup("Pillow"),
  "contourpy": g.lookup("contourpy"),
  "kiwisolver": g.lookup("kiwisolver"),
  "six": g.lookup("six"),
  "formulas": g.lookup("formulas"),
  "packaging": g.lookup("packaging"),
  "fonttools": g.lookup("fonttools"),
  "cycler": g.lookup("cycler"),
  "extras": g.lookup("numpy[test]"),
}))
`);
  const m = JSON.parse(out);
  assert.equal(m.numpy, '@ai-ecoverse/py-numpy');
  assert.equal(m.scipy, '@ai-ecoverse/py-scipy');
  assert.equal(m.pandas, '@ai-ecoverse/py-pandas');
  assert.equal(m.matplotlib, '@ai-ecoverse/py-matplotlib');
  assert.equal(m.pillow, '@ai-ecoverse/py-pillow');
  assert.equal(m.contourpy, '@ai-ecoverse/py-contourpy');
  assert.equal(m.kiwisolver, '@ai-ecoverse/py-kiwisolver');
  assert.equal(m.six, null);
  assert.equal(m.formulas, null);
  assert.equal(m.packaging, null);
  assert.equal(m.fonttools, null);
  assert.equal(m.cycler, null);
  assert.equal(m.extras, '@ai-ecoverse/py-numpy');
});

test('_slicc_pip: hint names pydata / Install/Update and pnpm add -g', () => {
  const out = py(`
import _slicc_pip as g
print(g.refuse("numpy"))
`);
  assert.match(out, /pip cannot install numpy on WASIX/);
  assert.match(out, /Python data tools/);
  assert.match(out, /\bpydata\b/);
  assert.match(out, /Install\/Update/);
  assert.match(out, /pnpm add -g @ai-ecoverse\/py-numpy/);
  assert.match(out, /pip install six/);
  assert.match(out, /--no-deps/);
  assert.equal(py('import _slicc_pip as g; print(g.refuse("six"))'), 'None');
});

test('_slicc_pip: install() wraps Factory.find_candidates', () => {
  const out = py(`
import types, _slicc_pip as g

class Factory:
    def find_candidates(self, identifier, *a, **k):
        return ["ok:" + identifier]

mod = types.ModuleType("pip._internal.resolution.resolvelib.factory")
mod.Factory = Factory
import sys
sys.modules[mod.__name__] = mod

# Fake InstallationError where pip keeps it.
exc = types.ModuleType("pip._internal.exceptions")
class InstallationError(Exception):
    pass
exc.InstallationError = InstallationError
sys.modules["pip"] = types.ModuleType("pip")
sys.modules["pip._internal"] = types.ModuleType("pip._internal")
sys.modules["pip._internal.exceptions"] = exc

g._patched = False
g.install()
f = Factory()
try:
    f.find_candidates("numpy")
    print("FAIL: numpy was allowed")
except InstallationError as e:
    print("blocked:" + ("pydata" in str(e) and "numpy" in str(e) and "OK" or str(e)))
print("six:" + f.find_candidates("six")[0])
`);
  assert.match(out, /^blocked:OK$/m);
  assert.match(out, /^six:ok:six$/m);
});
