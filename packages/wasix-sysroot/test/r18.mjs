/**
 * wasix-sysroot 2025.9.30-18: test/r18.c built against this sysroot, run on
 * the kernel's Node entry. On -17 (the negative): select with exceptfds
 * fails with ENOSYS (52), chdir("..") from a symlinked directory lands in
 * the symlink's parent, a 0.2 s select timeout returns at once, every TZ is
 * UTC, and
 * socketpair(SOCK_NONBLOCK|SOCK_CLOEXEC) fails.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const cwd = '/home/r18';
  assert.equal((await run(['mkdir', '-p', cwd], { cwd: '/home' })).status, 0);
  const r = await run(['r18', cwd], { cwd });
  assert.equal(r.status, 0, `r18 rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
  const want = [
    'select data: n=1 r=1 e=0 errno=0',
    'select empty: n=0 errno=0 waited=yes',
    'pselect except only: n=0 e=0 errno=0 waited=yes',
    'chdir ln/..: rc=0,0 cwd=q/real f=open deep=1',
    'tz UTC 2026-01: gmtoff=0 isdst=0 12:00 UTC mktime=ok',
    'tz EST5EDT,M3.2.0,M11.1.0 2026-01: gmtoff=-18000 isdst=0 07:00 EST mktime=ok',
    'tz EST5EDT,M3.2.0,M11.1.0 2026-07: gmtoff=-14400 isdst=1 08:00 EDT mktime=ok',
    'tz CET-1CEST,M3.5.0,M10.5.0/3 2026-07: gmtoff=7200 isdst=1 14:00 CEST mktime=ok',
    'tz <+0530>-5:30 2026-03: gmtoff=19800 isdst=0 17:30 +0530 mktime=ok',
    'socketpair flags: rc=0 nonblock=1 cloexec=1 read=-1 eagain=1',
    'socketpair plain: rc=0 nonblock=0',
    'r18 done',
  ];
  assert.deepEqual(r.stdout.trim().split('\n'), want, r.stdout);
}
