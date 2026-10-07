/**
 * procps checklist. Requires slicc-kernel with /proc (per-pid + uptime/meminfo).
 *
 * CDP runs are one-shot: the bash that backgrounds `sleep` exits before `ps`,
 * so we assert the sleep job (not a live interactive shell). Interactive-shell
 * + attached-worker visibility is the #66 follow-up.
 *
 * Bare `uptime`/`kill` can resolve to wasm-coreutils multi-call stubs (empty
 * /usr/bin/* markers that invoke coreutils without those applets). Invoke the
 * procps glue by absolute path for those names.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const bin = '/node_modules/@ai-ecoverse/wasm-procps/bin';

  const sleep = await run(['bash', '-c', 'sleep 100 & echo $!'], { cwd: '/home' });
  assert.equal(sleep.status, 0, `sleep background stderr=${sleep.stderr}`);
  const pid = sleep.stdout.trim();
  assert.match(pid, /^\d+$/, `expected pid, got ${JSON.stringify(sleep.stdout)}`);

  const ps = await run(['ps', 'aux'], { cwd: '/home' });
  assert.equal(ps.status, 0, `ps aux stderr=${ps.stderr}`);
  assert.match(ps.stdout, /sleep/, `ps aux missing sleep:\n${ps.stdout}`);
  assert.match(ps.stdout, new RegExp(`\\b${pid}\\b`), `ps aux missing pid ${pid}:\n${ps.stdout}`);

  const pg = await run(['pgrep', 'sleep'], { cwd: '/home' });
  assert.equal(pg.status, 0, `pgrep stderr=${pg.stderr}`);
  assert.match(pg.stdout, new RegExp(`^${pid}$`, 'm'), `pgrep stdout=${pg.stdout}`);

  const pk = await run(['pkill', 'sleep'], { cwd: '/home' });
  assert.equal(pk.status, 0, `pkill stderr=${pk.stderr}`);

  const ps2 = await run(['ps', 'aux'], { cwd: '/home' });
  assert.equal(ps2.status, 0, `ps after pkill stderr=${ps2.stderr}`);
  assert.doesNotMatch(ps2.stdout, /sleep 100/, `sleep still listed:\n${ps2.stdout}`);

  const free = await run(['free', '-h'], { cwd: '/home' });
  assert.equal(free.status, 0, `free -h stderr=${free.stderr}`);
  assert.match(free.stdout, /Mem|total/i, `free -h stdout=${free.stdout}`);

  const up = await run([`${bin}/uptime`], { cwd: '/home' });
  assert.equal(up.status, 0, `uptime stderr=${up.stderr}`);
  assert.match(up.stdout, /up|load/i, `uptime stdout=${up.stdout}`);
}
