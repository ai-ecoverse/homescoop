/**
 * procps checklist. Requires slicc-kernel with /proc (per-pid + uptime/meminfo).
 * Until that kernel is released, run against ej75's #66 prerelease dist.
 */
export default async function (ctx) {
  const { run, assert } = ctx;

  // Background sleep via bash job control.
  const sleep = await run(['bash', '-c', 'sleep 100 & echo $!'], { cwd: '/home' });
  assert.equal(sleep.status, 0, `sleep background stderr=${sleep.stderr}`);
  const pid = sleep.stdout.trim();
  assert.match(pid, /^\d+$/, `expected pid, got ${JSON.stringify(sleep.stdout)}`);

  const ps = await run(['ps', 'aux'], { cwd: '/home' });
  assert.equal(ps.status, 0, `ps aux stderr=${ps.stderr}`);
  assert.match(ps.stdout, /sleep/, `ps aux missing sleep:\n${ps.stdout}`);
  assert.match(ps.stdout, /bash|sh/, `ps aux missing shell:\n${ps.stdout}`);

  const pg = await run(['pgrep', 'sleep'], { cwd: '/home' });
  assert.equal(pg.status, 0, `pgrep stderr=${pg.stderr}`);
  assert.match(pg.stdout, new RegExp(`^${pid}$`, 'm'), `pgrep stdout=${pg.stdout}`);

  const pk = await run(['pkill', 'sleep'], { cwd: '/home' });
  assert.equal(pk.status, 0, `pkill stderr=${pk.stderr}`);

  // sleep should be gone (allow a moment via another ps).
  const ps2 = await run(['ps', 'aux'], { cwd: '/home' });
  assert.equal(ps2.status, 0, `ps after pkill stderr=${ps2.stderr}`);
  assert.doesNotMatch(ps2.stdout, /sleep 100/, `sleep still listed:\n${ps2.stdout}`);

  const free = await run(['free', '-h'], { cwd: '/home' });
  assert.equal(free.status, 0, `free -h stderr=${free.stderr}`);
  assert.match(free.stdout, /Mem|total/i, `free -h stdout=${free.stdout}`);

  const up = await run(['uptime'], { cwd: '/home' });
  assert.equal(up.status, 0, `uptime stderr=${up.stderr}`);
  assert.match(up.stdout, /up|load/i, `uptime stdout=${up.stdout}`);
}
