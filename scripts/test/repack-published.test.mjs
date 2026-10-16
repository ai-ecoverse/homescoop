import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyPatch, patchTargets, rewriteTarball } from '../repack-published.mjs';
import { diffTarballs, readTarball } from '../diff-published.mjs';

const glue = (name) => `var Module=typeof Module!="undefined"?Module:{};/*${name} minified*/\n// runner\nif (typeof process !== 'undefined') {\n  run();\n}\n`;
const patch = (files) => files.map((f) => `--- a/package/bin/${f}\n+++ b/package/bin/${f}\n@@ -2,4 +2,5 @@\n // runner\n-if (typeof process !== 'undefined') {\n+// guarded\n+if (typeof process !== 'undefined' && !Module['noInitialRun']) {\n   run();\n }\n`).join('');

/** A base tarball like npm pack's: package/{package.json,bin/a,bin/b,bin/x.wasm}. */
function base(dir) {
  mkdirSync(join(dir, 'package/bin'), { recursive: true });
  writeFileSync(join(dir, 'package/package.json'), '{"name":"t","version":"1.0.0-1"}\n');
  writeFileSync(join(dir, 'package/bin/a'), glue('a'));
  writeFileSync(join(dir, 'package/bin/b'), glue('b'));
  writeFileSync(join(dir, 'package/bin/x.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  execFileSync('tar', ['-czf', join(dir, 'base.tgz'), '-C', dir, 'package']);
  return readFileSync(join(dir, 'base.tgz'));
}

test('patchTargets: the +++ b/ paths, once each', () => {
  assert.deepEqual(patchTargets(`notes\n${patch(['a', 'b'])}${patch(['a'])}`), ['package/bin/a', 'package/bin/b']);
});

test('applyPatch patches the base entries; repack keeps every other entry byte for byte', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repack-test-'));
  try {
    const tgz = base(dir);
    const entries = readTarball(tgz);
    const out = applyPatch(`header text\n\n${patch(['a', 'b'])}`, (t) => entries.get(t)?.data);
    assert.deepEqual([...out.keys()], ['package/bin/a', 'package/bin/b']);
    for (const f of ['a', 'b']) assert.equal(out.get(`package/bin/${f}`).toString(), glue(f).replace("if (typeof process !== 'undefined') {", "// guarded\nif (typeof process !== 'undefined' && !Module['noInitialRun']) {"));
    out.set('package/package.json', Buffer.from('{"name":"t","version":"1.0.0-2"}\n'));
    const next = rewriteTarball(tgz, out);
    const res = diffTarballs(next, tgz, { allow: ['bin/a', 'bin/b'], baseLabel: 'base' });
    assert.ok(res.ok, res.errors.join('\n'));
    const after = readTarball(next);
    assert.equal(after.get('package/bin/x.wasm').sha256, entries.get('package/bin/x.wasm').sha256);
    assert.equal(after.get('package/bin/a').mode, entries.get('package/bin/a').mode);
    assert.ok(!diffTarballs(next, tgz, { allow: ['bin/a'], baseLabel: 'base' }).ok, 'an unlisted patched file is a difference');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applyPatch refuses a hunk that does not apply, a target the base lacks, and paths outside package/', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repack-test-'));
  try {
    const entries = readTarball(base(dir));
    const get = (t) => entries.get(t)?.data;
    assert.throws(() => applyPatch(patch(['a']).replace("process !== 'undefined') {", "process === 'nope') {"), get), /patch failed/);
    assert.throws(() => applyPatch(patch(['zz']), get), /not a file of the base/);
    assert.throws(() => applyPatch(patch(['a']).replaceAll('package/bin/a', '../bin/a'), get), /not under package/);
    assert.throws(() => applyPatch('no diff here\n', get), /names no/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
