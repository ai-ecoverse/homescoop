/**
 * procps checklist. Requires slicc-kernel with /proc (per-pid + uptime/meminfo).
 *
 * CDP runs are one-shot: the bash that backgrounds `sleep` exits before `ps`,
 * so we assert the sleep job (not a live interactive shell). Interactive-shell
 * + attached-worker visibility is the #66 follow-up.
 *
 * Needs wasm-coreutils ≥9.12.0-2 (no stub `uptime`/`kill` in slicc.commands)
 * so PATH `kill`/`uptime` resolve to this package. Bash builtin `kill` is
 * unchanged; `env kill` exercises the binary on PATH.
 *
 * Procps ships its own `kill` (`bin/kill`) — safe to drop coreutils' stub.
 */
export default async function (ctx) {
  const { run, assert } = ctx;

  const startSleep = async () => {
    const r = await run(['bash', '-c', 'sleep 100 & echo $!'], { cwd: '/home' });
    assert.equal(r.status, 0, `sleep background stderr=${r.stderr}`);
    const pid = r.stdout.trim();
    assert.match(pid, /^\d+$/, `expected pid, got ${JSON.stringify(r.stdout)}`);
    return pid;
  };

  const pid = await startSleep();

  const ps = await run(['ps', 'aux'], { cwd: '/home' });
  assert.equal(ps.status, 0, `ps aux stderr=${ps.stderr}`);
  assert.match(ps.stdout, /sleep/, `ps aux missing sleep:\n${ps.stdout}`);
  assert.match(ps.stdout, new RegExp(`\\b${pid}\\b`), `ps aux missing pid ${pid}:\n${ps.stdout}`);

  const pg = await run(['pgrep', '-f', 'sleep 100'], { cwd: '/home' });
  assert.equal(pg.status, 0, `pgrep stderr=${pg.stderr}`);
  assert.match(pg.stdout, new RegExp(`^${pid}$`, 'm'), `pgrep stdout=${pg.stdout}`);

  // PATH kill binary (not bash builtin) — requires coreutils without stub kill.
  const ek = await run(['env', 'kill', '-TERM', pid], { cwd: '/home' });
  assert.equal(ek.status, 0, `env kill -TERM stderr=${ek.stderr}`);

  const ps2 = await run(['ps', 'aux'], { cwd: '/home' });
  assert.equal(ps2.status, 0, `ps after env kill stderr=${ps2.stderr}`);
  assert.doesNotMatch(
    ps2.stdout,
    new RegExp(`\\b${pid}\\b`),
    `pid ${pid} still listed:\n${ps2.stdout}`,
  );

  const pid2 = await startSleep();
  const pg2 = await run(['pgrep', '-f', 'sleep 100'], { cwd: '/home' });
  assert.equal(pg2.status, 0, `pgrep before pkill stderr=${pg2.stderr}`);
  assert.match(pg2.stdout, new RegExp(`^${pid2}$`, 'm'), `pgrep before pkill: ${pg2.stdout}`);

  const pk = await run(['pkill', '-f', 'sleep 100'], { cwd: '/home' });
  assert.equal(pk.status, 0, `pkill stderr=${pk.stderr}`);

  const free = await run(['free', '-h'], { cwd: '/home' });
  assert.equal(free.status, 0, `free -h stderr=${free.stderr}`);
  assert.match(free.stdout, /Mem|total/i, `free -h stdout=${free.stdout}`);

  const up = await run(['uptime'], { cwd: '/home' });
  assert.equal(up.status, 0, `uptime stderr=${up.stderr}`);
  assert.match(up.stdout, /up|load/i, `uptime stdout=${up.stdout}`);
}
