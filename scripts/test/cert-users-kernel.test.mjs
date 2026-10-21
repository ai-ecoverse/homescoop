import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const USERS_FLOOR = [1, 44, 0];
const USES_USERS = /\baddUser\s*\(|\buser\s*:\s*['"\d]/;

const parse = (v) => v.split('-')[0].split('.').map(Number);
const below = (v, floor) => {
  const a = parse(v);
  for (let i = 0; i < 3; i++) if (a[i] !== floor[i]) return a[i] < floor[i];
  return false;
};

function kernelOf(meta, rootPin) {
  const spec = meta.kernel || '';
  return spec ? spec.slice(spec.lastIndexOf('@') + 1) : rootPin;
}

function usersKernelFindings(dir, rootPin) {
  const out = [];
  for (const pkg of readdirSync(join(dir, 'packages')).sort()) {
    const cert = join(dir, 'packages', pkg, 'cert');
    if (!existsSync(cert)) continue;
    const metaPath = join(cert, 'meta.json');
    const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
    const kernel = kernelOf(meta, rootPin);
    const specs = readdirSync(cert).filter((f) => f.endsWith('.mjs') && USES_USERS.test(readFileSync(join(cert, f), 'utf8')));
    if (specs.length && below(kernel, USERS_FLOOR)) out.push(`${pkg}: ${specs.join(', ')} add or switch users, but the cert kernel ${kernel} has no kernel.users (slicc-kernel >= ${USERS_FLOOR.join('.')})`);
  }
  return out;
}

const rootPin = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies['@ai-ecoverse/slicc-kernel'];

test('every cert that adds or switches users pins a kernel with kernel.users (homescoop#1450)', () => {
  assert.deepEqual(usersKernelFindings(root, rootPin), []);
});

test('nano pins a kernel with kernel.users for locking.mjs (homescoop#1450)', () => {
  const meta = JSON.parse(readFileSync(join(root, 'packages/nano/cert/meta.json'), 'utf8'));
  assert.equal(below(kernelOf(meta, rootPin), USERS_FLOOR), false);
  assert.equal(below('1.26.6', USERS_FLOOR), true);
  assert.equal(below('1.44.0', USERS_FLOOR), false);
  assert.equal(below('1.132.1', USERS_FLOOR), false);
});
