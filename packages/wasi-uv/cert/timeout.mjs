import plain from 'node:assert/strict';
import { detached } from './lib/detached.mjs';

export const expected = (line) => line.replace(/^wasi-uv: FAIL /, 'timeout: expected, the row hangs uv on purpose: ');

const names = "for d in /proc/[0-9]*; do read -r s < $d/stat 2>/dev/null && echo \"$s\"; done; exit 0";

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const env = { UV_CONFIG_FILE: '/home/uvt.toml' };
  const uvs = async () => {
    const r = await run(['bash', '-c', names], { cwd: '/home', env });
    return r.stdout.split('\n').filter((l) => / \((uv|python3?)\) /.test(l));
  };
  await write('/home/uvt.toml', 'no-index = true\n');
  const mk = await run(['bash', '-c', 'mkdir -p /home/t'], { cwd: '/home', env });
  assert.equal(mk.status, 0, mk.stderr);
  assert.deepEqual(await uvs(), [], 'no uv or python running before the case');
  const hang = "uv run --no-project python -c 'import time; print(\"hang\", flush=True); time.sleep(600)'";
  const slow = detached({ ...ctx, assert: plain }, { env, root: '/home/t', budgetMs: 15000, pollMs: 3000, log: (line) => console.log(expected(line)) });
  let running = [];
  const probe = async () => {
    running = await uvs();
  };
  const pending = slow(hang, '/home/t');
  for (let i = 0; i < 10 && !running.some((l) => / \(uv\) /.test(l)); i++) {
    await new Promise((res) => setTimeout(res, 1000));
    await probe();
  }
  assert.ok(running.some((l) => / \(uv\) /.test(l)), `uv runs while the case waits: ${running.join(' | ')}`);
  await assert.rejects(pending, (err) => /^wasi-uv: FAIL uv run --no-project python .*: no exit within 15 s \(detached, polled; \d+ s\)/.test(err.message));
  let left = await uvs();
  for (let i = 0; i < 10 && left.length; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    left = await uvs();
  }
  assert.deepEqual(left, [], `a timed-out detached uv leaves no uv or python behind (homescoop#1578): ${left.join(' | ')}`);
  const seen = running.map((l) => / \(([^)]+)\) /.exec(l)[1]);
  console.log(`timeout: ok: the hung uv run failed at its 15 s budget as intended, and its process group is gone (running at the first probe: ${seen.join(', ')})`);
}
