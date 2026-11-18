import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from '../../py-kiwisolver/test/wasm-call-signatures.mjs';
import { check } from './side-imports.mjs';

const here = new URL('..', import.meta.url).pathname;
const site = `${here}package/lib/python3.15/site-packages/`;
const backend = `${site}_cffi_backend.cpython-315-wasm32-wasix.so`;

function pin(file) {
  const y = readFileSync(file, 'utf8');
  const block = y.slice(y.indexOf('\n  libffi:\n'));
  const field = (k) => (block.match(new RegExp(`\\n    ${k}: "([^"]+)"`)) || [])[1];
  return { url: field('url'), sha256: field('sha256'), commit: field('commit'), tree: field('tree') };
}

test("the libffi headers come from wasix-python's own libffi pin", () => {
  const mine = pin(`${here}recipe.yaml`);
  assert.ok(mine.sha256 && mine.commit && mine.tree, JSON.stringify(mine));
  assert.deepEqual(mine, pin(`${here}../wasix-python/recipe.yaml`));
});

test("_cffi_backend imports libffi from python.wasm and defines none of its own", () => {
  const r = check(readFileSync(backend));
  assert.deepEqual(r.problems, []);
});

test('every PyMethodDef and PyGetSetDef function has the arity CPython calls it with', () => {
  const r = parse(readFileSync(backend));
  assert.ok(r.methods >= 60, `expected _cffi_backend's method defs, found ${r.methods}`);
  assert.ok(r.getsets >= 10, `expected _cffi_backend's getset defs, found ${r.getsets}`);
  assert.deepEqual(r.problems, [], `call_indirect would trap: ${JSON.stringify(r.problems, null, 1)}`);
});
