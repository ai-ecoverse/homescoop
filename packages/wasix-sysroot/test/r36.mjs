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
  // POLLHUP alone, as on Linux, from slicc-kernel 1.125.0 (nbytes 0 when empty,
  // slicc-kernel#1054, homescoop#1133); older kernels say nbytes 1: POLLIN|POLLHUP.
  null,
  'poll POLLIN on a read end with data, writer gone: 1 revents=POLLIN|POLLHUP',
  // A stream socket at EOF stays readable (read returns 0), as on Linux.
  'poll POLLIN on a socketpair end, peer closed, empty: 1 revents=POLLIN|POLLHUP',
  'poll POLLIN on a socketpair end, peer SHUT_WR: 1 revents=POLLIN',
  'poll POLLOUT on a socketpair end, peer closed: 1 revents=POLLOUT|POLLHUP',
  'r36 done',
];

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['r36'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const [maj, min] = String(ctx.kernelVersion).split('.').map(Number);
  const nbytes = maj > 1 || min >= 125 || ctx.kernelVersion === '0.0.0';
  const want = WANT.map((w) => w ?? `poll POLLIN on an empty read end, writer gone: 1 revents=${nbytes ? 'POLLHUP' : 'POLLIN|POLLHUP'}`);
  assert.deepEqual(r.stdout.trim().split('\n'), want, r.stdout);
  // The kernel sets HOSTNAME on every start, whatever the caller passes.
  const h = await run(['r36'], { cwd: '/tmp', env: { HOSTNAME: 'box1' } });
  assert.equal(h.stdout.trim().split('\n')[3], 'gethostname: 0 = HOSTNAME (HOSTNAME set)', h.stdout);
  console.log(`r36 (${ctx.variant}, slicc-kernel ${ctx.kernelVersion}): ppoll/pselect/epoll_pwait with a ready fd return it and leave a pending SIGUSR1 the empty mask unblocks pending (#949); gethostname() is HOSTNAME, the kernel's node name (#1050); poll(POLLIN|POLLOUT) on a reader-less pipe write end is POLLOUT|POLLERR and POLLOUT on a socketpair end whose peer closed is POLLOUT|POLLHUP (#975); POLLIN on an empty pipe read end whose writers are gone is POLLHUP alone from slicc-kernel 1.125.0 (#1133), while a socket at EOF or after the peer's SHUT_WR stays POLLIN`);
}
