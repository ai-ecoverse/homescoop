export const build = { asyncify: true };

const HEAD = ['setlk wr: 0', 'bad type: -1 Invalid argument', 'closed fd: -1 Bad file descriptor'];
const TAIL = ['child exit 0', 'lockf tlock: 0', 'lockf ulock: 0', 'r30lock done'];
const KERNEL = [
  'child setlk wr: -1 Resource temporarily unavailable',
  'child setlk other range: 0',
  'child getlk: 0 type=1 start=0 len=5 holder=parent',
  'child lockf test: -1 Permission denied',
  'parent unlock: 0',
  'child setlkw: 0',
];
const LOCAL = [
  'child setlk wr: 0',
  'child setlk other range: 0',
  'child getlk: 0 type=2 start=2 len=1 holder=-',
  'child lockf test: 0',
  'child setlkw: 0',
  'parent unlock: 0',
];

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['r30lock'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const lines = r.stdout.trim().split('\n');
  assert.deepEqual(lines.slice(0, 3), HEAD, r.stdout);
  assert.deepEqual(lines.slice(-4), TAIL, r.stdout);
  const mid = lines.slice(3, -4);
  const kernel = mid[0] === KERNEL[0];
  if (process.env.R30_LOCK === '1') assert.ok(kernel, `R30_LOCK=1 but ${mid[0]}`);
  assert.deepEqual(mid, kernel ? KERNEL : LOCAL, r.stdout);
  console.log(kernel
    ? `r30lock (${ctx.variant}): fcntl locks through slicc.fcntl_lock: the parent's write lock on bytes 0-4 makes the fork child's F_SETLK EAGAIN, a disjoint range works, F_GETLK names the parent's lock (F_WRLCK 0+5), lockf F_TEST EACCES, F_SETLKW waits for the parent's unlock; bad l_type EINVAL, closed fd EBADF; lockf F_TLOCK/F_ULOCK`
    : `r30lock (${ctx.variant}): no slicc.fcntl_lock (ENOSYS): the local answer (every lock granted, F_GETLK F_UNLCK), as programs saw before; bad l_type EINVAL, closed fd EBADF; lockf links`);
}
