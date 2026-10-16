const UNIX = [
  'getsockname: family=AF_UNIX len=path+1 path=/tmp/r31.sock',
  'accept peer: family=AF_UNIX len=family path=-',
  'client getpeername: family=AF_UNIX len=path+1 path=/tmp/r31.sock',
  'client getsockname: family=AF_UNIX len=family path=-',
  'short buffer: 0 family=AF_UNIX len=full untouched=1',
];
const POLL = (n) => [
  `${n} events0 hup: 1 revents=POLLHUP fast`,
  `${n} events0 readable/writable: 0 revents=0,0 waited`,
  `${n} pollin after close: 1 revents=POLLIN|POLLHUP`,
  `${n} events0 write end, reader gone: 1 revents=POLLERR`,
  `${n} events0 writable write end, peer closes later: 1 revents=POLLERR in time`,
  `${n} events0 readable read end, peer closes later: 1 revents=POLLHUP in time`,
];

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['r31'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const lines = r.stdout.trim().split('\n');
  assert.deepEqual(lines.slice(0, 17), [...UNIX, ...POLL('poll'), ...POLL('ppoll')], r.stdout);
  const rest = lines.slice(17);
  assert.equal(rest.at(-1), 'r31 done', r.stdout);
  const sems = rest.slice(0, -1);
  let semNote = 'no kernel semaphores';
  if (sems[0]?.startsWith('sems: no kernel semaphores')) {
    assert.ok(process.env.R30_SEM !== '1', `R30_SEM=1 but ${sems[0]}`);
  } else {
    const done = sems.at(-1).match(/^sems: opened (\d+), values right (\d+), closed\+unlinked (\d+)$/);
    assert.ok(done, r.stdout);
    const [opened, right, closed] = done.slice(1).map(Number);
    assert.equal(right, opened, r.stdout);
    assert.equal(closed, opened, r.stdout);
    if (process.env.R31_SEMS === '1') assert.equal(opened, 1000, `R31_SEMS=1 (slicc-kernel#770) but ${sems.join(' / ')}`);
    else assert.ok(opened === 1000 || (opened === 256 && /stopped at 256: No file descriptors available/.test(sems[0])), r.stdout);
    semNote = opened === 1000 ? '1000 distinct named semaphores open, read and close (no 256 cap)' : "the kernel's 256-handle cap (EMFILE, slicc-kernel#770); the libc table no longer limits it";
  }
  console.log(`r31 (${ctx.variant}): AF_UNIX getsockname/getpeername/accept give AF_UNIX with the path (length offsetof+strlen+1) or an unnamed address, bind/connect take sizeof(struct sockaddr_un), a short buffer is filled up to its size with the full length returned; poll and ppoll: an events-0 entry reports POLLHUP for a hung-up pipe at once and POLLERR for a write end whose reader is gone, a readable/writable events-0 pair waits out the timeout, and a ready events-0 entry still reports a hangup that comes later (re-checked every 50 ms); sems: ${semNote}`);
}
