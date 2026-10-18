import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { failuresOf, splitOnReference, compareOnReference, stillFails, findLimit } from '../browser-cert/compat.mjs';

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

const G = 'packages/wasix-gnupg/cert/concurrent.mjs';
const loop = (fails) => Array.from({ length: 8 }, (_, i) => `${G}:88${i ? `#${i + 1}` : ''}`).filter((id) => !fails.includes(id));

test('slicc-kernel run 38992090760: the same lines fail on both kernels on other loop iterations, so nothing regresses', () => {
  const both = [`${G}:64`, `${G}:65`, `${G}:66`, `${G}:95`];
  const candFail = [...both, `${G}:81#2`, `${G}:88#4`, `${G}:88#5`, `${G}:88#6`];
  const refFail = [...both, `${G}:81`, `${G}:81#2`, `${G}:88`, `${G}:88#2`, `${G}:88#3`];
  const cand = rep([spec('concurrent.mjs', [`${G}:81`, ...loop(candFail)], candFail)]);
  const ref = rep([spec('concurrent.mjs', loop(refFail), refFail)]);
  const fails = failuresOf(cand);
  const { same, rest } = splitOnReference(fails, ref);
  assert.equal(rest.length, 0, `no candidate failure is new: ${rest.map((f) => f.key)}`);
  assert.equal(same.length, candFail.length);
  for (const f of fails) assert.equal(compareOnReference(f, ref).verdict, 'known', f.key);
  const retry = rep([spec('concurrent.mjs', loop([`${G}:88#7`]), [`${G}:88#7`])]);
  assert.ok(stillFails(fails.find((f) => f.key === `${G}:88#4`), retry), 'a retry failing the line on another iteration still fails');
});

test('NEGATIVE: a line that fails only on the candidate is a regression, whatever its instance number', () => {
  const candFail = [`${G}:64`, `${G}:88#4`];
  const cand = rep([spec('concurrent.mjs', loop(candFail), candFail)]);
  const ref = rep([spec('concurrent.mjs', [...loop([]), `${G}:88#4`], [`${G}:64`])]);
  const { same, rest } = splitOnReference(failuresOf(cand), ref);
  assert.deepEqual(same.map((f) => f.key), [`${G}:64`]);
  assert.deepEqual(rest.map((f) => f.key), [`${G}:88#4`]);
  assert.equal(compareOnReference(rest[0], ref).verdict, 'regression');
  const table = rep([spec('concurrent.mjs', loop([`${G}:88#3`, `${G}:88#4`, `${G}:88#5`]), [`${G}:88#3`, `${G}:88#4`, `${G}:88#5`])]);
  const one = rep([spec('concurrent.mjs', loop([`${G}:88#2`]), [`${G}:88#2`])]);
  const split = splitOnReference(failuresOf(table), one);
  assert.equal(split.same.length, 0, 'the reference failing one iteration does not cover three on the candidate');
  for (const f of split.rest) assert.equal(compareOnReference(f, one).verdict, 'regression', f.key);
  const elsewhere = rep([spec('concurrent.mjs', loop([]), [`${G}:89#4`])]);
  assert.equal(compareOnReference(rest[0], elsewhere).verdict, 'regression', 'another line failing on the reference does not cover :88');
});

test('known-limits: wasix-gnupg concurrent.mjs is known-racy below 2.4.9-9 only, every case but trustdb, engines and crashes', () => {
  const limits = JSON.parse(readFileSync(new URL('../browser-cert/known-limits.json', import.meta.url), 'utf8')).limits;
  const facts = (version) => ({ package: '@ai-ecoverse/wasix-gnupg', recipe: 'wasix-gnupg', spec: 'concurrent.mjs', version, kernel: '1.113.1-pr.924.38992090760', users: 'off', text: `${G}:88#4: cone: run 2 failed only on an unlocked keybox read` });
  for (const v of ['2.4.9-5', '2.4.9-6', '2.4.9-7', '2.4.9-8']) assert.equal(findLimit(limits, facts(v))?.issue, 'ai-ecoverse/homescoop#712', v);
  for (const v of ['2.4.9-9', '2.4.9-10', '2.5.0-1']) assert.equal(findLimit(limits, facts(v)), null, `${v} is still held to concurrent.mjs`);
  assert.equal(findLimit(limits, { ...facts('2.4.9-5'), spec: 'checklist.mjs' }), null, 'only concurrent.mjs');
  for (const text of ['TypeError: cannot read properties of undefined', `cone: --check-trustdb:\ntrustdb=2`, 'engines.slicc-kernel is >=1.100.0, the first kernel with slicc.fcntl_lock: >=1.86.0']) {
    assert.equal(findLimit(limits, { ...facts('2.4.9-5'), text }), null, `still compared with the reference: ${text}`);
  }
  assert.ok(findLimit(limits, { ...facts('2.4.9-5'), text: 'gpg waits for the lock (2.4.9-7 doesn\'t):\nheld' }));
  // #1018: which key 2.4.9-5 loses differs per run, so every per-key case must be covered, not a list of them.
  for (const text of ['root: key 2 is in the keyring:\nuid U0', 'cone: key 3 is in the keyring:\nuid U1', 'root round 1 (held): import 4 logs no error:\ngpg: keydb_search failed']) {
    assert.ok(findLimit(limits, { ...facts('2.4.9-5'), text }), `known below 2.4.9-9: ${text}`);
  }
  assert.equal(findLimit(limits, { ...facts('2.4.9-5'), text: 'cone: key 1 is in the keyring:\nx\nRuntimeError: memory access out of bounds' }), null, 'a crash inside a per-key case is still compared');
});
