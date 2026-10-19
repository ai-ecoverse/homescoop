import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWLIST, allowlisted, bytes, heapFields, inspect, verdict } from '../check-threaded-heap.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leb = (n) => {
  const out = [];
  do {
    let b = n & 127;
    n >>>= 7;
    if (n) b |= 128;
    out.push(b);
  } while (n);
  return out;
};
const section = (id, body) => [id, ...leb(body.length), ...body];
const str = (s) => [...leb(s.length), ...Buffer.from(s)];
const module = ({ shared = true, imported = true, initial = 4096, ops = [0xfc, 0x0b, 0x00], dylink = false } = {}) => {
  const limits = shared ? [0x03, ...leb(initial), ...leb(65536)] : [0x00, ...leb(initial)];
  const parts = [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0];
  if (dylink) parts.push(...section(0, [...str('dylink.0')]));
  parts.push(...section(1, [1, 0x60, 0, 0]));
  if (imported) parts.push(...section(2, [1, ...str('env'), ...str('memory'), 2, ...limits]));
  parts.push(...section(3, [1, 0]));
  if (!imported) parts.push(...section(5, [1, ...limits]));
  const fn = [0, 0x41, 0, 0x41, 0, 0x41, 0, ...ops, 0x0b];
  parts.push(...section(10, [1, ...leb(fn.length), ...fn]));
  return Buffer.from(parts);
};
const SIZED = { 'initial-memory': '256MiB', 'measured-peak': '232MiB', 'measured-by': 'cert/stress.mjs on 1.132.0' };

test('inspect: a shared memory, imported or defined, and the memory.fill / memory.copy count', () => {
  assert.deepEqual(inspect(module()), { memory: { imported: true, shared: true, memory64: false, initial: 4096, max: 65536 }, fills: 1, copies: 0, side: false });
  const own = inspect(module({ imported: false, ops: [0xfc, 0x0a, 0x00, 0x00] }));
  assert.equal(own.memory.imported, false);
  assert.equal(own.copies, 1);
  assert.equal(inspect(module({ shared: false })).memory.shared, false);
  assert.equal(inspect(module({ dylink: true })).side, true);
  assert.equal(inspect(Buffer.from('#!/bin/sh\n')), null);
});

test('heapFields and bytes: sizes with units, whole pages, the peak under the heap, a named measurement', () => {
  assert.equal(bytes('256MiB'), 256 * 1024 ** 2);
  assert.equal(bytes('64 KiB'), 65536);
  assert.equal(bytes('lots'), null);
  assert.deepEqual(heapFields(SIZED).problems, []);
  assert.match(heapFields({ ...SIZED, 'measured-peak': '300MiB' }).problems.join(), /above wasm.initial-memory/);
  assert.match(heapFields({ ...SIZED, 'initial-memory': '100KiB' }).problems.join(), /whole number of 64 KiB pages/);
  assert.match(heapFields({ ...SIZED, 'measured-by': '' }).problems.join(), /names no run/);
});

test('verdict: a threaded bulk-memory main module needs the fields; its linked heap must be the recorded one; side modules and plain ones pass', () => {
  const m = (o) => ({ file: 'bin/x.wasm', ...inspect(module(o)) });
  assert.match(verdict('x', undefined, null, [m()]).problems.join(), /needs wasm: \{ initial-memory, measured-peak, measured-by \}/);
  assert.deepEqual(verdict('x', SIZED, null, [m()]).problems, []);
  assert.match(verdict('x', SIZED, null, [m({ initial: 100 })]).problems.join(), /links an initial memory of 6\.25 MiB, not wasm.initial-memory 256MiB/);
  assert.deepEqual(verdict('x', undefined, null, [m({ shared: false }), m({ ops: [] }), m({ dylink: true })]).problems, []);
  assert.deepEqual(verdict('x', undefined, '#1287', [m()]).problems, []);
});

test('verdict: an allowlist entry for a sized or non-threaded package is stale', () => {
  const m = { file: 'bin/x.wasm', ...inspect(module()) };
  assert.match(verdict('x', SIZED, '#1287', [m]).problems.join(), /has wasm.initial-memory: drop the line/);
  assert.match(verdict('x', undefined, '#1287', []).problems.join(), /no module of it has a shared memory with bulk-memory opcodes: drop the line/);
});

test('the allowlist: "<recipe> #<issue> <reason>" lines, each an existing recipe', () => {
  assert.equal(allowlisted('a', 'a #1287 why\n'), '#1287');
  assert.equal(allowlisted('b', 'a #1287 why\n'), null);
  assert.throws(() => allowlisted('a', 'a because\n'), /not "<recipe> #<issue> <reason>"/);
  for (const line of readFileSync(ALLOWLIST, 'utf8').split('\n')) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const name = l.split(/\s+/)[0];
    assert.ok(existsSync(join(root, 'packages', name, 'recipe.yaml')), `${name}: no packages/${name}/recipe.yaml`);
    assert.equal(allowlisted(name), '#1287', l);
  }
});
