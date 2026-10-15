export const build = { asyncify: true };

const POLL = (n) => [
  `${n} mixed: 1 revents=1,0,0,0`,
  `${n} none: 0 revents=0,0 waited`,
  `${n} nval: 1 nval=1 revents=0 fast`,
  `${n} other bits: 0 revents=0`,
];

const EPOLL = [
  'epoll: yes cloexec=1',
  'ctl add: 0',
  'ctl add again: -1 File exists',
  'wait: 1 events=1 data=100000000',
  'ctl mod: 0',
  'wait mod: 1 data=0',
  'ctl del: 0',
  'ctl del again: -1 No such file or directory',
  'ctl bad op: -1 Invalid argument',
  'ctl not epoll: -1 Invalid argument',
  'wait not epoll: -1 Invalid argument',
  'wait idle: 0',
  'many: 70 distinct=70',
];

const PWAIT = 'pwait: -1 Interrupted system call handler=1 fast blocked=1';
const RT = ['rt main=1', 'rt thread=1', 'rt child=1', 'rt exec=1', 'rt child exit=0'];

const atLeast = (v, min) => {
  const a = v.split('-')[0].split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['r29'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const lines = r.stdout.trim().split('\n');
  const [head] = lines;
  const kmask = head === 'kernel sigmask: yes';
  if (process.env.R28_KERNEL_MASK === '1') assert.ok(kmask, `R28_KERNEL_MASK=1 but ${head}`);
  if (!kmask) assert.equal(head, 'kernel sigmask: no', r.stdout);
  assert.deepEqual(lines.slice(1, 9), [...POLL('poll'), ...POLL('ppoll')], r.stdout);
  const said = [`poll and ppoll: an entry with events 0 or no read/write bit is skipped (no ENOSYS), a bad fd among them is POLLNVAL at once, only such entries wait out the timeout`];
  let rest = lines.slice(9);
  const epoll = rest[0] === 'epoll: yes cloexec=1';
  if (process.env.R29_EPOLL === '1') assert.ok(epoll, `R29_EPOLL=1 but ${rest[0]}`);
  if (epoll) {
    assert.deepEqual(rest.slice(0, EPOLL.length), EPOLL, r.stdout);
    rest = rest.slice(EPOLL.length);
    if (kmask) {
      assert.equal(rest[0], PWAIT, r.stdout);
      rest = rest.slice(1);
    }
    said.push(`epoll: EPOLL_CLOEXEC, Linux ADD/MOD/DEL reach the kernel as WASIX ADD/MOD/DEL, errors are -1 with errno (EEXIST, ENOENT, EINVAL), data.u64 comes back whole, 70 ready fds in one wait${kmask ? ', epoll_pwait runs a pending blocked signal and returns EINTR at once with the mask restored' : ''}`);
  } else {
    assert.equal(rest[0], 'epoll: -1 Function not implemented', r.stdout);
    rest = rest.slice(1);
    said.push('epoll: the kernel has no WASIX epoll (ENOSYS)');
  }
  const k193 = atLeast(ctx.kernelVersion, '1.93.0');
  if (kmask) {
    if (k193) assert.deepEqual(rest.slice(0, RT.length), RT, r.stdout);
    else assert.equal(rest[0], 'rt main=1', r.stdout);
    rest = rest.slice(RT.length);
  }
  assert.deepEqual(rest, ['r29 done'], r.stdout);
  if (kmask && k193) {
    const t = await run(['bash', '-c', 'r29 bothterm; echo rc=$?'], { cwd: '/tmp' });
    assert.equal(t.stdout, 'rc=143\n', `${t.stdout}${t.stderr}`);
    assert.match(t.stderr, /Terminated/, t.stderr);
    said.push('signal 40 blocked in main is blocked in a new thread, a fork and the exec\'d image; SIGTERM sent to a thread that unblocks it while main blocks it too ends the process by SIGTERM (bash: Terminated, 143)');
  }
  console.log(`r29 (${ctx.variant}, slicc-kernel ${ctx.kernelVersion}): ${said.join('; ')}`);
}
