import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinErrors, rangeAllowed } from '../check-exact-pins.mjs';
import { diffPackageJson } from '../diff-published.mjs';

const CU = '@ai-ecoverse/wasm-coreutils';
const xz = (field, spec, version = '5.8.4-8') => ({ name: '@ai-ecoverse/wasm-xz', version, [field]: { [CU]: spec } });

test('pinErrors: a peer "*" on an @ai-ecoverse command package passes', () => {
  assert.deepEqual(pinErrors(xz('peerDependencies', '*')), []);
  assert.deepEqual(pinErrors({ name: '@ai-ecoverse/wasm-git', peerDependencies: { [CU]: '*', '@ai-ecoverse/wasm-bash': '*' } }), []);
  assert.equal(rangeAllowed(xz('peerDependencies', '*'), 'peerDependencies', CU, '*'), true);
});

test('pinErrors: every other peer range and every non-peer "*" still fails', () => {
  for (const spec of ['>=1.0.0', '>=9.12.0-15', '^9.12.0-15', '~9.12.0', 'x', '*.*.*', ' *', '* ', '>=0.0.0-0', '* || 1.0.0', 'latest', '', null]) {
    assert.equal(pinErrors(xz('peerDependencies', spec)).length, 1, `peer ${JSON.stringify(spec)}`);
  }
  assert.equal(pinErrors(xz('dependencies', '*')).length, 1);
  assert.equal(pinErrors(xz('optionalDependencies', '*')).length, 1);
  assert.equal(rangeAllowed(xz('dependencies', '*'), 'dependencies', CU, '*'), false);
  assert.equal(rangeAllowed(xz('peerDependencies', '*'), 'peerDependencies', 'coreutils', '*'), false);
  assert.deepEqual(pinErrors(xz('peerDependencies', '9.12.0-15')), []);
});

test('diffPackageJson: an exact peer may become "*", not a range, and a dependency may not', () => {
  const base = xz('peerDependencies', '9.12.0-15', '5.8.4-7');
  const ok = diffPackageJson(base, xz('peerDependencies', '*'));
  assert.deepEqual(ok.errors, []);
  assert.ok(ok.changes.includes(`peerDependencies["${CU}"]: 9.12.0-15 → *`), ok.changes.join('\n'));
  assert.equal(diffPackageJson(base, xz('peerDependencies', '>=1.0.0')).errors.length, 1);
  assert.equal(diffPackageJson(xz('dependencies', '9.12.0-15', '5.8.4-7'), xz('dependencies', '*')).errors.length, 1);
});
