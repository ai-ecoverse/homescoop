export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['r27'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const lines = r.stdout.trim().split('\n');
  assert.deepEqual(lines.slice(0, 16), [
    'utimensat NULL: r=0 errno=0 mtime=now',
    'utimensat NOW,NOW: r=0 errno=0 mtime=now',
    'utimensat OMIT,7: r=0 errno=0 mtime=7',
    'utimensat 5,OMIT: r=0 errno=0 mtime=kept',
    'utimensat NOW,7: r=0 errno=0 mtime=7',
    'utimensat 5,NOW: r=0 errno=0 mtime=now',
    'utimensat OMIT,OMIT: r=0 errno=0 mtime=kept',
    'utimensat 5,7: r=0 errno=0 mtime=7',
    'utimensat bad nsec: r=-1 errno=EINVAL mtime=kept',
    'utimensat dirfd NULL: r=0 errno=0 mtime=now',
    'futimens NULL: r=0 errno=0 mtime=now',
    'futimens OMIT,NOW: r=0 errno=0 mtime=now',
    'utimes NULL: r=0 errno=0 mtime=now',
    'utime NULL: r=0 errno=0 mtime=now',
    'utime 5,7: r=0 errno=0 mtime=7',
    'utimensat missing NULL: r=-1 errno=ENOENT mtime=7',
  ], r.stdout);
  const num = (line, key) => Number(new RegExp(`${key}=([0-9.]+)`).exec(line)?.[1]);
  const burn = lines.find((l) => l.startsWith('burn:'));
  const sleep = lines.find((l) => l.startsWith('sleep:'));
  assert.ok(num(burn, 'kernel') >= 0.45 && num(burn, 'kernel') <= 0.8, `burn: ${burn}`);
  for (const key of ['clock', 'tms_utime', 'ru_utime']) {
    for (const line of [burn, sleep]) assert.ok(Math.abs(num(line, key) - num(line, 'kernel')) <= 0.05, `${key} vs the kernel's process CPU clock: ${line}`);
  }
  if (process.env.R27_SLEEP_IS_CPU !== '1') assert.ok(num(sleep, 'kernel') <= 0.06, `a 0.4 s sleep added CPU time (slicc-kernel's PROCESS_CPUTIME_ID): ${sleep}`);
  assert.ok(num(sleep, 'elapsed') >= 0.35 && num(sleep, 'elapsed') <= 1.5, `times() elapsed: ${sleep}`);
  assert.deepEqual(lines.slice(-4), ['stime=0 cutime=0 cstime=0 ru_stime=0.000000', 'children: 0 0', 'bad who: -1 EINVAL', 'r27 done'], r.stdout);
  console.log(`r27: utimensat/futimens/utimes/utime with NULL, UTIME_NOW and UTIME_OMIT; ${burn}; ${sleep}`);
}
