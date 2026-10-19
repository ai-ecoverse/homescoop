import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inPythonRange, pinErrors, pythonRange, rangeAllowed } from '../check-exact-pins.mjs';
import { diffPackageJson } from '../diff-published.mjs';
import { lockErrors, newestFrom } from '../browser-cert/python-range.mjs';

const PY = '@ai-ecoverse/wasix-python';
const RANGE = '>=3.14.2-16 <3.14.3';
const numpy = (spec, field = 'dependencies') => ({ name: '@ai-ecoverse/py-numpy', version: '2.3.2-10', [field]: { [PY]: spec } });

test('pythonRange: >=X.Y.Z-N <X.Y.Z+1 only', () => {
  assert.deepEqual(pythonRange(RANGE), { floor: '3.14.2-16', below: '3.14.3' });
  for (const bad of ['3.14.2-16', '>=3.14.2-16', '>=3.14.2-16 <3.15.0', '>=3.14.2-16 <3.14.4', '>=3.14.2 <3.14.3', '>= 3.14.2-16 <3.14.3', '>=3.14.2-16 <3.14.3 ', '^3.14.2-16', '>=3.14.2-16 <3.14.3 || 4', '>=3.14.2-016 <3.14.3', '>=3.14.2-rc.1 <3.14.3', null, 3]) {
    assert.equal(pythonRange(bad), null, String(bad));
  }
});

test('inPythonRange: the X.Y.Z-N line from the floor, as npm semver', () => {
  for (const v of ['3.14.2-16', '3.14.2-24', '3.14.2-100', '3.14.2']) assert.equal(inPythonRange(v, RANGE), true, v);
  for (const v of ['3.14.2-15', '3.14.2-2', '3.14.3-1', '3.14.3', '3.15.0', '3.14.1-99', '3.14.2-24.1', 'latest']) assert.equal(inPythonRange(v, RANGE), false, v);
  assert.equal(inPythonRange('3.14.2-16', '3.14.2-16'), true);
  assert.equal(inPythonRange('3.14.2-24', '3.14.2-16'), false);
});

test('pinErrors: the range passes for wasix-python and py-* in a py-* dependencies, nowhere else', () => {
  assert.deepEqual(pinErrors(numpy(RANGE)), []);
  assert.deepEqual(pinErrors(numpy('3.14.2-24')), []);
  assert.equal(pinErrors(numpy(RANGE, 'peerDependencies')).length, 1);
  assert.equal(pinErrors(numpy(RANGE, 'optionalDependencies')).length, 1);
  assert.equal(pinErrors(numpy('>=3.14.2-16')).length, 1);
  assert.equal(pinErrors(numpy('^3.14.2-16')).length, 1);
  assert.equal(pinErrors({ name: '@ai-ecoverse/wasix-uv-shim', dependencies: { [PY]: RANGE } }).length, 1);
  assert.deepEqual(pinErrors({ name: '@ai-ecoverse/py-scipy', dependencies: { '@ai-ecoverse/py-numpy': '>=2.3.2-10 <2.3.3' } }), []);
  assert.equal(pinErrors({ name: '@ai-ecoverse/py-scipy', dependencies: { '@ai-ecoverse/py-numpy': '>=2.3.2-10 <2.4.0' } }).length, 1);
  assert.equal(pinErrors({ name: '@ai-ecoverse/py-scipy', peerDependencies: { '@ai-ecoverse/py-numpy': '>=2.3.2-10 <2.3.3' } }).length, 1);
  assert.equal(pinErrors({ name: '@ai-ecoverse/wasm-x', dependencies: { '@ai-ecoverse/py-numpy': '>=2.3.2-10 <2.3.3' } }).length, 1);
  assert.equal(pinErrors({ name: '@ai-ecoverse/py-x', dependencies: { '@ai-ecoverse/wasm-bash': '>=5.3.0-1 <5.3.1' } }).length, 1);
  assert.equal(rangeAllowed({ name: 'py-numpy' }, 'dependencies', PY, RANGE), false);
});

test('diffPackageJson: an exact python pin may become the range in a py-*, nothing wider', () => {
  const base = numpy('3.14.2-16');
  base.version = '2.3.2-9';
  const ok = diffPackageJson(base, numpy(RANGE));
  assert.deepEqual(ok.errors, []);
  assert.ok(ok.changes.includes(`dependencies["${PY}"]: 3.14.2-16 → ${RANGE}`), ok.changes.join('\n'));
  assert.equal(diffPackageJson(base, numpy('>=3.14.2-16')).errors.length, 1);
  assert.equal(diffPackageJson({ ...base, name: '@ai-ecoverse/wasm-git' }, { ...numpy(RANGE), name: '@ai-ecoverse/wasm-git' }).errors.length, 1);
  assert.deepEqual(diffPackageJson({ ...base, name: '@ai-ecoverse/wasm-emscripten' }, { ...numpy(RANGE), name: '@ai-ecoverse/wasm-emscripten' }).errors, [], 'wasm-emscripten runs emcc on wasix-python (PYTHON_CONSUMERS)');
});

test('lockErrors: one python, at the top level, at that version', () => {
  const lock = (extra = {}) => ({ packages: { '': {}, 'node_modules/@ai-ecoverse/py-numpy': { version: '2.3.2-10' }, [`node_modules/${PY}`]: { version: '3.14.2-24' }, ...extra } });
  assert.deepEqual(lockErrors(lock(), '3.14.2-24'), []);
  assert.deepEqual(lockErrors(lock(), '3.14.2-16'), [`node_modules/${PY} is 3.14.2-24, not 3.14.2-16`]);
  assert.deepEqual(lockErrors(lock({ [`node_modules/@ai-ecoverse/py-numpy/node_modules/${PY}`]: { version: '3.14.2-16' } }), '3.14.2-24'), [
    `a second python: node_modules/@ai-ecoverse/py-numpy/node_modules/${PY} 3.14.2-16`,
  ]);
  assert.deepEqual(lockErrors({ packages: {} }, '3.14.2-24'), [`node_modules/${PY} is missing, not 3.14.2-24`]);
});

test('newestFrom: the wasix-python of cert/meta.json needsInstall', () => {
  assert.equal(newestFrom({ needsInstall: ['@ai-ecoverse/wasm-bash@5.3.0-13', `${PY}@3.14.2-24`] }), '3.14.2-24');
  assert.equal(newestFrom({ needs: [PY] }), null);
  assert.equal(newestFrom({ needsInstall: [`${PY}-x@1.0.0`] }), null);
});

test('wasm-emscripten, which runs emcc on wasix-python, may take wasix-python as the range too, and nothing else', () => {
  const em = (deps) => ({ name: '@ai-ecoverse/wasm-emscripten', dependencies: deps });
  assert.deepEqual(pinErrors(em({ [PY]: '>=3.15.0-2 <3.15.1' })), []);
  assert.equal(pinErrors(em({ [PY]: '>=3.15.0-2 <3.16.0' })).length, 1);
  assert.equal(pinErrors(em({ '@ai-ecoverse/wasm-clang': '>=24.0.0-22 <24.0.1' })).length, 1);
  assert.equal(pinErrors(em({ '@ai-ecoverse/py-numpy': '>=2.3.2-10 <2.3.3' })).length, 1);
  assert.equal(pinErrors({ name: '@ai-ecoverse/wasm-emscripten', peerDependencies: { [PY]: '>=3.15.0-2 <3.15.1' } }).length, 1);
});
