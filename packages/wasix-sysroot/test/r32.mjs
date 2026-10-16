export const build = { asyncify: true };

const NEW = [
  'kernel sigmask_epoll_wait: yes',
  'kernel sigwait: yes',
  'kernel sigaction_inherited: yes',
  'pwait race: rounds=200 eintr=200 other=0 slow=0 worst=<1s handled=all blocked=1',
  'pwait ready: 1 data=7 blocked=1',
  'pwait zero: 1 fast',
  'sigwait: Success sig=12 handler=0',
  'sigwaitinfo: 10 signo=10 code=SI_USER handler=0',
  'sigtimedwait 200ms: -1 Resource temporarily unavailable on time',
  'sigtimedwait 0: -1 Resource temporarily unavailable fast',
  'sigtimedwait bad: -1 Invalid argument',
  'sigtimedwait through a handled alarm: -1 Resource temporarily unavailable alarm=1 full timeout',
  "sigwaitinfo from another thread's kill: 10 in time handler=0",
  'default child: zombie status=3',
  'SA_NOCLDWAIT child: reaped (No child process)',
  'SIG_DFL again child: zombie status=3',
  'r32 done',
];

const OLD_WAITS = [
  'sigwait: Function not implemented sig=-7 handler=0',
  'sigwaitinfo: -1 Function not implemented signo=0 code=? handler=0',
  'sigtimedwait 200ms: -1 Function not implemented early',
  'sigtimedwait 0: -1 Function not implemented fast',
  'sigtimedwait bad: -1 Invalid argument',
  'sigtimedwait through a handled alarm: -1 Function not implemented alarm=0 early',
  "sigwaitinfo from another thread's kill: -1 Function not implemented off handler=0",
];

const INHERIT_NEW = ['inherit: PIPE=ign USR2=ign CHLD=ign TERM=dfl', 'inherit child: reaped (No child process)', 'inherit then handled: USR2=handler handler=1'];
const INHERIT_OLD = ['inherit: PIPE=dfl USR2=dfl CHLD=dfl TERM=dfl', 'inherit child: zombie status=3', 'inherit then handled: USR2=handler handler=1'];
const PLAIN = ['inherit: PIPE=dfl USR2=dfl CHLD=dfl TERM=dfl', 'inherit child: zombie status=3', 'inherit then handled: USR2=handler handler=1'];

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['r32'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const lines = r.stdout.trim().split('\n');
  const has = lines.slice(0, 3).map((l) => l.endsWith(': yes'));
  const all = has.every(Boolean);
  const none = !has.some(Boolean);
  assert.ok(all || none, `the kernel has some of the three imports: ${lines.slice(0, 3).join(' / ')}`);
  if (process.env.R32_KERNEL === '1') assert.ok(all, `R32_KERNEL=1 but ${lines.slice(0, 3).join(' / ')}`);
  const said = [];
  if (all) {
    assert.deepEqual(lines, NEW, r.stdout);
    said.push('epoll_pwait through slicc.sigmask_epoll_wait: 200 rounds of a SIGUSR1 sent at a random 0-3 ms into epoll_pwait(2 s, empty mask) all end EINTR at once, none waits out the 2 s, and SIGUSR1 is blocked again after; a ready fd gives its event');
    said.push('sigwait/sigwaitinfo/sigtimedwait through slicc.sigwait: a pending blocked signal is taken without its handler (sigwait 0, sig 12; sigwaitinfo 10, si_code SI_USER), a 200 ms timeout is EAGAIN on time, {0,0} EAGAIN at once, tv_nsec 1e9 EINVAL, a handled SIGALRM 200 ms into a 600 ms wait runs its handler and the wait goes on to EAGAIN at 600 ms (musl retries EINTR), another thread\'s kill(getpid()) is taken');
    said.push('SA_NOCLDWAIT reaches the kernel: the child is reaped (ECHILD), SIG_DFL brings back a waitable zombie');
  } else {
    assert.deepEqual(lines.slice(0, 3), ['kernel sigmask_epoll_wait: no', 'kernel sigwait: no', 'kernel sigaction_inherited: no'], r.stdout);
    assert.match(lines[3], /^pwait race: rounds=200 eintr=\d+ other=\d+ slow=\d+ worst=[<>]1s handled=(all|some) blocked=1$/, r.stdout);
    assert.deepEqual(lines.slice(4, 6), ['pwait ready: 1 data=7 blocked=1', 'pwait zero: 1 fast'], r.stdout);
    assert.deepEqual(lines.slice(6, 13), OLD_WAITS, r.stdout);
    assert.deepEqual(lines.slice(13), ['default child: zombie status=3', 'SA_NOCLDWAIT child: zombie status=3', 'SIG_DFL again child: zombie status=3', 'r32 done'], r.stdout);
    said.push(`no kernel imports (ENOSYS): epoll_pwait keeps -31's mask swap (${lines[3].replace('pwait race: ', '')}), sigwait/sigwaitinfo/sigtimedwait are ENOSYS as up to -31, SA_NOCLDWAIT has no effect`);
  }
  const t = await run(['bash', '-c', "trap '' PIPE USR2 CHLD; exec r32 inherit"], { cwd: '/tmp' });
  assert.equal(t.status, 0, `${t.stdout}${t.stderr}`);
  assert.deepEqual(t.stdout.trim().split('\n'), all ? INHERIT_NEW : INHERIT_OLD, t.stdout);
  const p = await run(['bash', '-c', 'exec r32 inherit'], { cwd: '/tmp' });
  assert.equal(p.status, 0, `${p.stdout}${p.stderr}`);
  assert.deepEqual(p.stdout.trim().split('\n'), PLAIN, p.stdout);
  said.push(all
    ? "under bash trap '' PIPE USR2 CHLD, sigaction reads back SIG_IGN for the three (slicc.sigaction_inherited) and SIG_DFL for TERM, the inherited SIGCHLD ignore reaps, and a handler installed over an inherited ignore runs; without the trap all four are SIG_DFL"
    : 'without slicc.sigaction_inherited the libc table starts all SIG_DFL, as up to -31');
  console.log(`r32 (${ctx.variant}, slicc-kernel ${ctx.kernelVersion}): ${said.join('; ')}`);
}
