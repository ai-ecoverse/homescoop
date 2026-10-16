import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GLUE_USER, glueByPath, glueCheckPlan, glueTargets } from '../browser-cert/glue.mjs';

const coreutils = {
  slicc: {
    commands: {
      cp: { glue: 'bin/coreutils', wasm: 'bin/coreutils.wasm', argv0: 'cp' },
      ls: { glue: '${package}/bin/coreutils', wasm: 'bin/coreutils.wasm', argv0: 'ls' },
      tar: { glue: './bin/tar', wasm: 'bin/tar.wasm' },
      rg: { wasm: 'bin/rg.wasm' },
    },
  },
};
const ok = { soft: false, live: false, modes: 'tarball', users: 'enforce', kernelVersion: '1.94.0', meta: {}, manifest: coreutils };

test('glueTargets: one entry per distinct glue file, none for wasm-only commands', () => {
  assert.deepEqual(glueTargets(coreutils), [
    { glue: 'bin/coreutils', command: 'cp' },
    { glue: 'bin/tar', command: 'tar' },
  ]);
  assert.deepEqual(glueTargets({ slicc: { abi: 'wasi', commands: { rg: { wasm: 'bin/rg.wasm' } } } }), []);
  assert.deepEqual(glueTargets({}), []);
});

test('glueCheckPlan: ladder-pr runs it; kernel-compat (--soft), --live, old kernels, users off and an opt-out skip it', () => {
  assert.equal(glueCheckPlan(ok).run, true);
  assert.equal(glueCheckPlan({ ...ok, users: '', kernelVersion: '1.74.0' }).run, true);
  for (const [over, why] of [
    [{ soft: true }, /--soft/],
    [{ live: true }, /--live/],
    [{ modes: 'kernel defaults' }, /no kernel\.chmod before slicc-kernel 1\.86\.0/],
    [{ users: 'off' }, /users off is not enforce/],
    [{ users: 'report' }, /users report is not enforce/],
    [{ users: '', kernelVersion: '1.73.3' }, /users kernel default is not enforce/],
    [{ meta: { glueByPath: false } }, /glueByPath: false/],
    [{ manifest: { slicc: { commands: { rg: { wasm: 'bin/rg.wasm' } } } } }, /no slicc\.commands glue/],
  ]) {
    const p = glueCheckPlan({ ...ok, ...over });
    assert.equal(p.run, false, JSON.stringify(over));
    assert.match(p.why, why);
  }
});

function fakeCtx(answers) {
  const calls = [];
  return {
    calls,
    async addUser(o) {
      calls.push(['addUser', o]);
      if (answers.addUser) throw new Error(answers.addUser);
    },
    async run(argv, o) {
      calls.push(['run', argv, o]);
      const a = answers[argv[0]];
      if (a instanceof Error) throw a;
      return a;
    },
  };
}

test('glueByPath: runs each glue by path as certglue; rc 126 or EACCES fails, anything else (another status, another error) passes', async () => {
  const ctx = fakeCtx({
    '/node_modules/@ai-ecoverse/x/bin/coreutils': { status: 0, stdout: 'coreutils 9.12\n', stderr: '' },
    '/node_modules/@ai-ecoverse/x/bin/tar': new Error('Error: EACCES: /node_modules/@ai-ecoverse/x/bin/tar'),
  });
  const r = await glueByPath(ctx, { installDir: 'node_modules/@ai-ecoverse/x/', targets: glueTargets(coreutils), log: () => {} });
  assert.deepEqual(ctx.calls[0], ['addUser', { name: GLUE_USER }]);
  assert.deepEqual(ctx.calls[1], ['run', ['/node_modules/@ai-ecoverse/x/bin/coreutils', '--version'], { cwd: '/tmp', user: GLUE_USER, stdin: '' }]);
  assert.equal(r.spec, 'glue-by-path');
  assert.equal(r.status, 'fail');
  assert.deepEqual(r.cases.pass, ['glue-by-path:bin/coreutils']);
  assert.deepEqual(r.cases.fail, [{ id: 'glue-by-path:bin/tar', message: 'bin/tar (command tar) run by path as certglue: EACCES: /node_modules/@ai-ecoverse/x/bin/tar' }]);

  const bash = fakeCtx({ '/p/bin/tar': { status: 126, stdout: '', stderr: 'bash: /p/bin/tar: Permission denied\n' } });
  const b = await glueByPath(bash, { installDir: 'p/', targets: [{ glue: 'bin/tar', command: 'tar' }], log: () => {} });
  assert.equal(b.status, 'fail');
  assert.match(b.error, /bin\/tar \(command tar\) run by path as certglue: rc 126, bash: \/p\/bin\/tar: Permission denied/);

  const fine = fakeCtx({ addUser: 'user certglue exists', '/p/bin/tar': { status: 2, stdout: '', stderr: 'tar: unknown option\n' } });
  const f = await glueByPath(fine, { installDir: 'p/', targets: [{ glue: 'bin/tar', command: 'tar' }], log: () => {} });
  assert.equal(f.status, 'pass');
  const odd = fakeCtx({ '/p/bin/tar': new Error('Error: Runtime.evaluate: no answer in 120000 ms') });
  assert.equal((await glueByPath(odd, { installDir: 'p/', targets: [{ glue: 'bin/tar', command: 'tar' }], log: () => {} })).status, 'pass');
  await assert.rejects(glueByPath(fakeCtx({ addUser: 'users are off' }), { installDir: 'p/', targets: [], log: () => {} }), /users are off/);
});

test('glueFallback (#628): a cert kernel before 1.86, or users not enforce, gets a --glue-only run on the dev pin', async () => {
  const { glueFallback } = await import('../browser-cert/glue.mjs');
  const pin = '@ai-ecoverse/slicc-kernel@1.102.6';
  const at = (v) => `@ai-ecoverse/slicc-kernel@${v}`;
  const fb = (meta, certKernel, manifest = coreutils, fallbackKernel = pin) => glueFallback({ meta, manifest, certKernel, fallbackKernel });
  assert.deepEqual(fb({}, at('1.12.0')), { why: `${at('1.12.0')}: the kernel keeps its default modes (no kernel.chmod before slicc-kernel 1.86.0)`, kernel: pin, users: 'enforce' });
  assert.match(fb({ users: 'off' }, at('1.94.0')).why, /users off is not enforce/);
  assert.match(fb({ users: 'report' }, at('1.94.0')).why, /users report is not enforce/);
  assert.equal(fb({ users: 'enforce' }, at('1.94.0')), null);
  assert.equal(fb({}, at('1.94.0')), null, 'users default enforce since 1.74');
  assert.equal(fb({ glueByPath: false }, at('1.12.0')), null);
  assert.equal(fb({}, at('1.12.0'), { slicc: { commands: { rg: { wasm: 'bin/rg.wasm' } } } }), null);
  assert.throws(() => fb({}, at('1.12.0'), coreutils, at('1.80.0')), /fallback kernel .*1\.80\.0 cannot run it either/);
});

test('runMode and glueStep (#628): --glue-only skips specs and smoke, runs the glue, and fails when it cannot', async () => {
  const { runMode, glueStep } = await import('../browser-cert/glue.mjs');
  assert.deepEqual(runMode({ glueOnly: true, specs: 3, abi: 'emscripten', commands: 1 }), { mode: 'glue-only' });
  assert.deepEqual(runMode({ glueOnly: true, specs: 0, abi: 'wasi', commands: 0 }), { mode: 'glue-only' }, 'never the early skip');
  assert.deepEqual(runMode({ glueOnly: false, specs: 2, abi: 'wasi', commands: 0 }), { mode: 'specs' });
  assert.deepEqual(runMode({ glueOnly: false, specs: 0, abi: 'emscripten', commands: 1 }), { mode: 'smoke' });
  assert.equal(runMode({ glueOnly: false, specs: 0, abi: 'wasi', commands: 1 }).mode, 'skip');
  assert.equal(runMode({ glueOnly: false, specs: 0, abi: 'emscripten', commands: 0 }).mode, 'skip');

  assert.deepEqual(glueStep({ glueOnly: true, plan: glueCheckPlan(ok) }), { action: 'run' });
  assert.deepEqual(glueStep({ glueOnly: false, plan: glueCheckPlan(ok) }), { action: 'run' });
  const old = glueCheckPlan({ ...ok, modes: 'kernel defaults' });
  const f = glueStep({ glueOnly: true, plan: old });
  assert.equal(f.action, 'fail');
  assert.match(f.why, /--glue-only, but glue by path cannot run: .*1\.86\.0/);
  assert.deepEqual(glueStep({ glueOnly: false, plan: old }), { action: 'skip', why: old.why, log: true });
  const none = glueCheckPlan({ ...ok, manifest: {} });
  assert.equal(glueStep({ glueOnly: true, plan: none }).action, 'fail', 'glue-only with no glue fails');
  assert.deepEqual(glueStep({ glueOnly: false, plan: none }), { action: 'skip', why: none.why, log: false });
});
