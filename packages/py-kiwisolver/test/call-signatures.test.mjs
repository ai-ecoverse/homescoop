import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from './wasm-call-signatures.mjs';

const site = new URL('../package/lib/python3.14/site-packages/', import.meta.url).pathname;

function sideModules(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) sideModules(p, out);
    else if (e.endsWith('.so')) out.push(p);
  }
  return out;
}

test('every PyMethodDef and PyGetSetDef function has the arity CPython calls it with', () => {
  const sos = sideModules(site);
  assert.deepEqual(sos.map((p) => p.slice(site.length)), ['kiwisolver/_cext.cpython-314-wasm32-wasix.so']);
  const r = parse(readFileSync(sos[0]));
  assert.ok(r.methods >= 27, `expected kiwisolver's 27 method defs, found ${r.methods}`);
  assert.ok(r.getsets >= 4, `expected the 4 strength getters, found ${r.getsets}`);
  assert.deepEqual(r.problems, [], `call_indirect would trap: ${JSON.stringify(r.problems, null, 1)}`);
});
