export const build = { asyncify: true };

// slicc-kernel >= 1.117.3: slicc.sigwait_info / siginfo_take (1.114.0), slicc.flock (1.117.0),
// flock waits restarted under SA_RESTART (1.117.3).
const NEW = [
  'kernel sigwait_info: yes',
  'kernel flock: yes',
  'sigwaitinfo kill from child: 10 code=SI_USER pid=sender uid=mine',
  'sigtimedwait SIGCHLD: 17 code=CLD_EXITED pid=sender uid=mine status=7',
  'sigwaitinfo pthread_kill: 12 code=SI_TKILL pid=sender uid=mine',
  'SA_SIGINFO handler, kill from child: signo=1 code=SI_USER pid=sender uid=mine ctx=1',
  'SA_SIGINFO handler, raise: signo=1 code=SI_USER pid=sender uid=mine',
  'flock pipe read end ex: 0',
  'flock pipe write end ex|nb: -1 Resource temporarily unavailable',
  'flock pipe read end un: 0',
  'flock pipe write end ex|nb again: 0',
  'flock read-only a ex: 0',
  'flock read-only b ex|nb: -1 Resource temporarily unavailable',
  'flock read-only b sh|nb: -1 Resource temporarily unavailable',
  'flock dup of a ex|nb: 0',
  'flock inherited a in a child ex|nb: 0',
  'flock a un: 0',
  'flock read-only b ex|nb after: 0',
  'flock bad fd: -1 Bad file descriptor',
  'flock bad op: -1 Invalid argument',
  'flock wait, plain handler: -1 Interrupted system call alarm=1 at the signal',
  'flock wait, SA_RESTART handler: 0 alarm=1 after the holder',
];

// A kernel without the imports (the cert kernel): sigwait* are ENOSYS as on -32
// (that kernel has no slicc.sigwait either), SA_SIGINFO handlers run with SI_USER
// and pid 0, flock falls back to a whole-file fcntl lock (EBADF for LOCK_EX on a
// read-only descriptor and on a pipe, as fcntl record locks are).
const OLD = [
  'kernel sigwait_info: no',
  'kernel flock: no',
  /^sigwaitinfo kill from child: (-1 Function not implemented code=SI_USER pid=0 uid=mine|10 code=SI_USER pid=0 uid=mine)$/,
  /^sigtimedwait SIGCHLD: (-1 Function not implemented code=SI_USER pid=0 uid=mine status=0|17 code=SI_USER pid=0 uid=mine status=0)$/,
  /^sigwaitinfo pthread_kill: (-1 Function not implemented|12) code=SI_USER pid=0 uid=mine$/,
  'SA_SIGINFO handler, kill from child: signo=1 code=SI_USER pid=0 uid=mine ctx=1',
  'SA_SIGINFO handler, raise: signo=1 code=SI_USER pid=0 uid=mine',
  'flock pipe read end ex: -1 Bad file descriptor',
  'flock pipe write end ex|nb: -1 Bad file descriptor',
  'flock pipe read end un: -1 Bad file descriptor',
  'flock pipe write end ex|nb again: -1 Bad file descriptor',
  'flock read-only a ex: -1 Bad file descriptor',
  'flock read-only b ex|nb: -1 Bad file descriptor',
  'flock read-only b sh|nb: 0',
  'flock dup of a ex|nb: -1 Bad file descriptor',
  'flock inherited a in a child ex|nb: Bad file descriptor',
  'flock a un: 0',
  'flock read-only b ex|nb after: -1 Bad file descriptor',
  'flock bad fd: -1 Bad file descriptor',
  'flock bad op: -1 Invalid argument',
  'flock wait, plain handler: -1 Bad file descriptor alarm=0 at the signal',
  'flock wait, SA_RESTART handler: -1 Bad file descriptor alarm=0 at the signal',
];

const POLL = ['poll', 'ppoll'].flatMap((n) => [
  `${n} POLLOUT, reader gone: 1 revents=POLLOUT|POLLERR`,
  `${n} events0 readable, forked writer exits later: 1 revents=POLLHUP in time`,
]);

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['r33'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const lines = r.stdout.trim().split('\n');
  const all = lines[0] === 'kernel sigwait_info: yes' && lines[1] === 'kernel flock: yes';
  if (process.env.R33_KERNEL === '1') assert.ok(all, `R33_KERNEL=1 but ${lines.slice(0, 2).join(' / ')}`);
  const want = [...(all ? NEW : OLD), ...POLL, 'r33 done'];
  assert.equal(lines.length, want.length, r.stdout);
  want.forEach((w, i) => (w instanceof RegExp ? assert.match(lines[i], w, r.stdout) : assert.equal(lines[i], w, r.stdout)));
  const said = all
    ? [
        "siginfo_t has the sender (slicc.sigwait_info): a forked child's kill gives SI_USER with its pid and our uid, its exit CLD_EXITED status 7, pthread_kill SI_TKILL from us",
        'an SA_SIGINFO handler runs with (sig, siginfo_t, non-NULL context) and the sender from slicc.siginfo_take',
        'flock through slicc.flock: per open file description on a pipe (the other end conflicts), LOCK_EX on a read-only descriptor excludes another open, dup and an inherited descriptor share it, EBADF/EINVAL, a handled signal ends a wait with EINTR and SA_RESTART resumes it until the holder leaves',
      ]
    : ['no kernel imports: sigwait* as -32 on that kernel, SA_SIGINFO handlers run with SI_USER and pid 0, flock falls back to a whole-file fcntl lock'];
  said.push('poll/ppoll: a pipe write end without readers gives POLLOUT|POLLERR (#629), and an events-0 readable read end reports POLLHUP when a forked writer exits 200 ms in (#559)');
  console.log(`r33 (${ctx.variant}, slicc-kernel ${ctx.kernelVersion}): ${said.join('; ')}`);
}
