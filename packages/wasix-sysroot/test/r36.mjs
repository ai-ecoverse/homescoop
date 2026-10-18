export const build = { asyncify: true };

// -36: homescoop#949 (a ready fd wins over a pending signal the mask unblocks),
// #1050 (gethostname is the kernel's node name), #975 (poll on pipe and
// socket ends whose peer is gone).
const WANT = [
  'ppoll ready + pending SIGUSR1: 1 pending_after=1 handler_after_unblock=1',
  'pselect ready + pending SIGUSR1: 1 pending_after=1 handler_after_unblock=1',
  'epoll_pwait ready + pending SIGUSR1: 1 pending_after=1 handler_after_unblock=1',
  'gethostname: 0 = HOSTNAME (HOSTNAME set)',
  'poll POLLIN|POLLOUT on a write end, reader gone: 1 revents=POLLOUT|POLLERR',
  // Linux: POLLHUP alone; the kernel's read event doesn't say the pipe is empty (#975, known).
  'poll POLLIN on an empty read end, writer gone: 1 revents=POLLIN|POLLHUP',
  'poll POLLIN on a read end with data, writer gone: 1 revents=POLLIN|POLLHUP',
  'poll POLLOUT on a socketpair end, peer closed: 1 revents=POLLOUT|POLLHUP',
  'r36 done',
];

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['r36'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(r.stdout.trim().split('\n'), WANT, r.stdout);
  // The kernel sets HOSTNAME on every start, whatever the caller passes.
  const h = await run(['r36'], { cwd: '/tmp', env: { HOSTNAME: 'box1' } });
  assert.equal(h.stdout.trim().split('\n')[3], 'gethostname: 0 = HOSTNAME (HOSTNAME set)', h.stdout);
  console.log(`r36 (${ctx.variant}, slicc-kernel ${ctx.kernelVersion}): ppoll/pselect/epoll_pwait with a ready fd return it and leave a pending SIGUSR1 the empty mask unblocks pending (#949); gethostname() is HOSTNAME, the kernel's node name (#1050); poll(POLLIN|POLLOUT) on a reader-less pipe write end is POLLOUT|POLLERR and POLLOUT on a socketpair end whose peer closed is POLLOUT|POLLHUP (#975)`);
}
