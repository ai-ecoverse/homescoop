import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detached } from '../../packages/wasi-uv/cert/lib/detached.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cert = join(root, 'packages', 'wasi-uv', 'cert');

function hostCtx () {
  const calls = [];
  return {
    calls,
    assert,
    async write (path, text) {
      writeFileSync(path, text);
    },
    async run (argv, { cwd, env } = {}) {
      calls.push(argv);
      const r = spawnSync(argv[0], argv.slice(1), { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    },
  };
}

function scratch (t) {
  const dir = mkdtempSync(join(tmpdir(), 'uv-detached-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('detached: a command longer than one poll finishes with its rc, stdout, stderr and seconds', async (t) => {
  const dir = scratch(t);
  const ctx = hostCtx();
  const lines = [];
  const slow = detached(ctx, { root: dir, pollMs: 1000, budgetMs: 20000, log: (l) => lines.push(l) });
  const r = await slow('sleep 2; echo out-$FOO; echo err >&2', dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'out-\n');
  assert.equal(r.stderr, 'err\n');
  assert.ok(r.seconds >= 2, `seconds ${r.seconds}`);
  assert.match(lines.at(-1), /: rc=0 in \d+ s \(budget 20 s\)$/);
  assert.ok(ctx.calls.length >= 3, 'started and polled, not one blocking call');
});

test('detached: a failing command reports its own rc, never 0', async (t) => {
  const dir = scratch(t);
  const slow = detached(hostCtx(), { root: dir, pollMs: 1000, budgetMs: 20000, log: () => {} });
  const r = await slow('echo broken >&2; exit 3', dir);
  assert.equal(r.status, 3);
  assert.equal(r.stderr, 'broken\n');
});

test('detached: a command past the budget is a FAIL with a clear line, not a pass', async (t) => {
  const dir = scratch(t);
  const lines = [];
  const slow = detached(hostCtx(), { root: dir, pollMs: 1000, budgetMs: 2000, log: (l) => lines.push(l) });
  const t0 = Date.now();
  await assert.rejects(slow('exec sleep 30', dir), (err) => {
    assert.match(err.message, /^wasi-uv: FAIL exec sleep 30: no exit within 2 s \(detached, polled; \d+ s\)/);
    return true;
  });
  assert.ok(Date.now() - t0 < 15000, 'the deadline holds');
  assert.match(lines.at(-1), /^wasi-uv: FAIL exec sleep 30: no exit within 2 s/);
  const pid = readFileSync(join(dir, '.uv-detached-1', 'pid'), 'utf8').trim();
  assert.notEqual(spawnSync('kill', ['-0', pid]).status, 0, 'the timed-out command was killed');
});

test('detached: a timeout kills the whole process group, not only the wrapper (homescoop#1578)', async (t) => {
  const dir = scratch(t);
  const slow = detached(hostCtx(), { root: dir, pollMs: 1000, budgetMs: 2000, log: () => {} });
  const child = join(dir, 'child');
  t.after(() => {
    if (existsSync(child)) spawnSync('kill', ['-9', readFileSync(child, 'utf8').trim()]);
  });
  await assert.rejects(slow(`sleep 30 & echo $! > ${child}; wait`, dir), /no exit within 2 s/);
  const pid = readFileSync(child, 'utf8').trim();
  assert.match(pid, /^\d+$/);
  let alive = true;
  for (let i = 0; i < 20 && alive; i++) {
    alive = spawnSync('kill', ['-0', pid]).status === 0;
    if (alive) await new Promise((res) => setTimeout(res, 100));
  }
  assert.equal(alive, false, `the wrapper's child ${pid} was killed with its process group`);
  const runner = readFileSync(join(dir, '.uv-detached-1', 'runner.sh'), 'utf8');
  assert.match(runner, /^set -m$/m, 'the wrapper starts as a process-group leader');
});

test('wasi-uv cert: timeout.mjs times out a hung uv on purpose and checks no uv is left (homescoop#1578)', () => {
  const spec = readFileSync(join(cert, 'timeout.mjs'), 'utf8');
  assert.match(spec, /import \{ detached \} from '\.\/lib\/detached\.mjs';/);
  assert.match(spec, /a timed-out detached uv leaves no uv or python behind \(homescoop#1578\)/);
});

test('detached: a runner that never writes its rc times out as a FAIL', async (t) => {
  const dir = scratch(t);
  const ctx = hostCtx();
  const run = ctx.run;
  ctx.run = (argv, o) => (argv[2].includes('runner.sh </dev/null') ? Promise.resolve({ status: 0, stdout: '', stderr: '' }) : run(argv, o));
  const slow = detached(ctx, { root: dir, pollMs: 1000, budgetMs: 2000, log: () => {} });
  await assert.rejects(slow('true', dir), /FAIL true: no exit within 2 s/);
});

test('wasi-uv cert: the six sdist builds run detached in checklist.mjs and locks.mjs (homescoop#1541)', () => {
  const checklist = readFileSync(join(cert, 'checklist.mjs'), 'utf8');
  const locks = readFileSync(join(cert, 'locks.mjs'), 'utf8');
  for (const [name, src] of [['checklist.mjs', checklist], ['locks.mjs', locks]]) {
    assert.match(src, /import \{ detached \} from '\.\/lib\/detached\.mjs';/, `${name} imports the detached helper`);
  }
  assert.doesNotMatch(checklist, /\bok\('uv pip install --no-binary six six'/, 'checklist.mjs: the sdist build is not one blocking call');
  assert.match(checklist, /await slow\(sdistCmd, '\/home\/u'\)/);
  assert.doesNotMatch(locks, /await ok\(\s*"bash \/home\/race\.sh/, 'locks.mjs: no race is one blocking call');
  assert.equal(locks.match(/await okSlow\(\s*"bash \/home\/race\.sh/g)?.length, 2, 'locks.mjs: both races are polled');
});
