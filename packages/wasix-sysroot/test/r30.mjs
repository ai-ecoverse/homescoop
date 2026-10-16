export const build = { asyncify: true };

const KERNEL = [
  'sem_open: ok',
  'again excl: FAILED File exists',
  'reopen same pointer: 1',
  'missing: FAILED No such file or directory',
  'bad name: FAILED Invalid argument',
  'long name: FAILED Filename too long',
  'big value: FAILED Invalid argument',
  'trywait: -1 Resource temporarily unavailable',
  'post: 0',
  'value: 1',
  'trywait: 0',
  'timedwait: -1 Operation timed out not early',
  'past deadline with value: 0',
  'bad nsec: -1 Invalid argument',
  'fork ping-pong: 100 rounds, child exit 7',
  'exec child: post 0',
  'exec handoff: 0',
  'exec child exit 0',
  'unlink: 0',
  'unlink again: -1 No such file or directory',
  'post after unlink: 0',
  'close: 0 close: 0',
  'unnamed: 0 -1 Resource temporarily unavailable',
  'r30 done',
];

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['r30'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const lines = r.stdout.trim().split('\n');
  const kernel = lines[0] === 'sem_open: ok';
  if (process.env.R30_SEM === '1') assert.ok(kernel, `R30_SEM=1 but ${lines[0]}`);
  if (kernel) {
    assert.deepEqual(lines, KERNEL, r.stdout);
    console.log(`r30 (${ctx.variant}, slicc-kernel ${ctx.kernelVersion}): named semaphores through slicc.sem_*: O_EXCL EEXIST, a repeat open returns the same sem_t *, ENOENT/EINVAL/ENAMETOOLONG/value EINVAL, trywait EAGAIN then post/getvalue/trywait, sem_timedwait ETIMEDOUT not early, a past deadline with a value succeeds, tv_nsec EINVAL, 100 fork ping-pong rounds on inherited handles (the child's sem_open returns the same pointer), an exec'd child opens by name and posts, unlink then ENOENT while holders keep posting, close twice, unnamed semaphores unchanged`);
  } else {
    assert.deepEqual(lines, ['sem_open: No such file or directory', 'r30 done'], r.stdout);
    console.log(`r30 (${ctx.variant}, slicc-kernel ${ctx.kernelVersion}): no slicc.sem_* (ENOSYS): musl's file-based sem_open, ENOENT on this kernel's /dev/shm, as up to -29`);
  }
}
