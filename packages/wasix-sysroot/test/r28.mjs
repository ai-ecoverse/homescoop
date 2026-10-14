export const build = { asyncify: true };

const KERNEL = [
  'start: mask=- pending=-',
  'blocked: usr1=0 pending=USR1 mask=USR1',
  'unblocked: usr1=1 pending=- mask=-',
  'kill/stop: mask=USR2',
  'old: USR2 now=USR2,TERM',
  'cleared: old=USR2,TERM now=-',
  'bad how: Invalid argument',
  'main: usr1=0 pending=-',
  'thread: blocked usr1=0 pending=USR1 mask=USR1',
  'thread: unblocked usr1=1 in_thread=1 pending=-',
  'child: mask=USR2',
  'exec: mask=USR2',
  'parent: child exit=0',
  'r28 done',
];

const LOCAL = [
  'start: mask=- pending=-',
  'blocked: usr1=1 pending=- mask=USR1',
  'unblocked: usr1=1 pending=- mask=-',
  'kill/stop: mask=USR2',
  'old: USR2 now=USR2,TERM',
  'cleared: old=USR2,TERM now=-',
  'bad how: Invalid argument',
];

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['r28'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const [head, ...lines] = r.stdout.trim().split('\n');
  const kernel = head === 'kernel sigmask: yes';
  if (process.env.R28_KERNEL_MASK === '1') assert.ok(kernel, `R28_KERNEL_MASK=1 but ${head}`);
  if (kernel) {
    assert.deepEqual(lines, KERNEL, r.stdout);
    console.log(`r28 (${ctx.variant}): slicc.sigmask_set holds a blocked SIGUSR1 (sigpending shows it) and delivers it before sigprocmask returns; SIGKILL/SIGSTOP are not blocked; old masks are right; a thread's mask is its own; fork and exec keep the mask`);
  } else {
    assert.equal(head, 'kernel sigmask: no', r.stdout);
    assert.deepEqual(lines.slice(0, LOCAL.length), LOCAL, r.stdout);
    assert.ok(lines.includes('child: mask=USR2'), `fork keeps the libc mask: ${r.stdout}`);
    assert.equal(lines.at(-1), 'r28 done', r.stdout);
    console.log(`r28 (${ctx.variant}): a kernel without slicc.sigmask_set (ENOSYS): the libc keeps the mask (old masks right, SIGKILL/SIGSTOP dropped, kept across fork), sigpending is empty, a blocked signal is still delivered at once`);
  }
}
