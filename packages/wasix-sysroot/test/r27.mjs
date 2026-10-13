export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['r27'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const lines = r.stdout.trim().split('\n');
  assert.deepEqual(lines.slice(0, 16), [
    'utimensat NULL: r=0 errno=0 atime=now mtime=now',
    'utimensat NOW,NOW: r=0 errno=0 atime=now mtime=now',
    'utimensat OMIT,7: r=0 errno=0 atime=kept mtime=7',
    'utimensat 5,OMIT: r=0 errno=0 atime=5 mtime=kept',
    'utimensat NOW,7: r=0 errno=0 atime=now mtime=7',
    'utimensat 5,NOW: r=0 errno=0 atime=5 mtime=now',
    'utimensat OMIT,OMIT: r=0 errno=0 atime=kept mtime=kept',
    'utimensat 5,7: r=0 errno=0 atime=5 mtime=7',
    'utimensat bad nsec: r=-1 errno=EINVAL atime=kept mtime=kept',
    'utimensat dirfd NULL: r=0 errno=0 atime=now mtime=now',
    'futimens NULL: r=0 errno=0 atime=now mtime=now',
    'futimens OMIT,NOW: r=0 errno=0 atime=kept mtime=now',
    'utimes NULL: r=0 errno=0 atime=now mtime=now',
    'utime NULL: r=0 errno=0 atime=now mtime=now',
    'utime 5,7: r=0 errno=0 atime=5 mtime=7',
    'utimensat missing NULL: r=-1 errno=ENOENT atime=5 mtime=7',
  ], r.stdout);
  const num = (line, key) => Number(new RegExp(`${key}=([0-9.]+)`).exec(line)?.[1]);
  const burn = lines.find((l) => l.startsWith('burn:'));
  const sleep = lines.find((l) => l.startsWith('sleep:'));
  for (const key of ['clock', 'tms_utime', 'ru_utime']) {
    const v = num(burn, key);
    assert.ok(v >= 0.45 && v <= 0.8, `burn ${key}=${v}: ${burn}`);
    assert.ok(num(sleep, key) <= 0.06, `sleep ${key}: ${sleep}`);
  }
  assert.ok(num(sleep, 'elapsed') >= 0.35 && num(sleep, 'elapsed') <= 1.5, `times() elapsed: ${sleep}`);
  assert.deepEqual(lines.slice(-4), ['stime=0 cutime=0 cstime=0 ru_stime=0.000000', 'children: 0 0', 'bad who: -1 EINVAL', 'r27 done'], r.stdout);
  console.log(`r27: utimensat/futimens/utimes/utime with NULL, UTIME_NOW and UTIME_OMIT; ${burn}; ${sleep}`);
}
