import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failuresOf, splitOnReference, compareOnReference } from '../browser-cert/compat.mjs';

const rep = (specs) => ({ status: specs.some((s) => s.status === 'fail') ? 'fail' : 'pass', specs });
const spec = (name, pass, fail) => ({ spec: name, status: fail.length ? 'fail' : 'pass', cases: { pass, fail: fail.map((id) => ({ id, message: `${id} failed` })) } });

test('a candidate failure the reference has too skips the retry', () => {
  const cand = rep([spec('checklist.mjs', ['a'], ['b', 'c'])]);
  const ref = rep([spec('checklist.mjs', ['a', 'c'], ['b'])]);
  const { same, rest } = splitOnReference(failuresOf(cand), ref);
  assert.deepEqual(same.map((f) => f.key), ['b']);
  assert.deepEqual(rest.map((f) => f.key), ['c']);
  assert.equal(compareOnReference(same[0], ref).verdict, 'known');
});

test('a different failure in the same spec on the reference is not the same: retry', () => {
  const cand = rep([spec('checklist.mjs', ['a'], ['b'])]);
  const ref = rep([spec('checklist.mjs', ['b'], ['a'])]);
  const { same, rest } = splitOnReference(failuresOf(cand), ref);
  assert.equal(same.length, 0);
  assert.deepEqual(rest.map((f) => f.key), ['b']);
});

test('a spec the reference did not reach, or a different crash, is not the same: retry', () => {
  const cand = rep([{ spec: 'x.mjs', status: 'fail', crash: { message: 'boom', signature: 'sig-a' }, cases: { pass: [], fail: [] } }, spec('y.mjs', [], ['k'])]);
  const ref = rep([{ spec: 'x.mjs', status: 'fail', crash: { message: 'other', signature: 'sig-b' }, cases: { pass: [], fail: [] } }]);
  const { same, rest } = splitOnReference(failuresOf(cand), ref);
  assert.equal(same.length, 0);
  assert.deepEqual(rest.map((f) => `${f.spec}:${f.key}`), ['x.mjs:crash', 'y.mjs:k']);
});

test('the same crash signature on both kernels skips the retry', () => {
  const crash = { message: 'boom', signature: 'sig-a' };
  const cand = rep([{ spec: 'x.mjs', status: 'fail', crash, cases: { pass: [], fail: [] } }]);
  const ref = rep([{ spec: 'x.mjs', status: 'fail', crash, cases: { pass: [], fail: [] } }]);
  assert.equal(splitOnReference(failuresOf(cand), ref).same.length, 1);
});

test('a boot failure on both kernels skips the retry', () => {
  const cand = { status: 'fail', specs: [], error: 'no boot' };
  const ref = { status: 'fail', specs: [], error: 'no boot' };
  assert.equal(splitOnReference(failuresOf(cand), ref).same.length, 1);
});
