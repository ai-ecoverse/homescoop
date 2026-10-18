/**
 * pgrep -L -F (pidfile must be locked) takes flock(fd, LOCK_SH|LOCK_NB) and
 * calls the pidfile locked when that fails with EWOULDBLOCK. Since 4.0.7-4
 * flock() is shims/slicc's strong flock through env.__syscall_flock
 * (homescoop#947), which slicc-kernel 1.122.0 answers (slicc-kernel#968).
 * A perl holds LOCK_EX on the pidfile in another process: pgrep's second
 * open is refused, so it reads the pid and finds perl. Once perl is gone the
 * lock is too, and pgrep -L refuses the pidfile. 4.0.7-3's flock() was
 * Emscripten's stub, which always succeeds, so it refused the pidfile while
 * perl still held it. Run on slicc-kernel 1.122.0 (cert/meta.json
 * extra_kernels).
 */
const PIDFILE = '/tmp/procps-flock.pid';
const HOLD = String.raw`$| = 1; use Fcntl ":flock"; open(my $f, ">", "${PIDFILE}") or die "open: $!"; flock($f, LOCK_EX) or die "flock: $!"; $f->autoflush(1); print $f "$$\n"; print "held $$\n"; sleep 60;`;

export default async function (ctx) {
  const { run, assert } = ctx;
  const start = await run(['bash', '-c', `rm -f ${PIDFILE}; perl -e '${HOLD}' > /tmp/procps-flock.out 2>&1 & echo $!`], { cwd: '/tmp' });
  assert.equal(start.status, 0, `start the holder: ${start.stdout}${start.stderr}`);
  const ready = await run(['bash', '-c', 'for i in $(seq 100); do l=; read -r l < /tmp/procps-flock.out 2>/dev/null; [[ $l == "held "* ]] && { echo "$l"; exit 0; }; sleep 0.1; done; cat /tmp/procps-flock.out; exit 1'], { cwd: '/tmp' });
  assert.equal(ready.status, 0, `perl never took LOCK_EX on ${PIDFILE}: ${ready.stdout}${ready.stderr}`);
  const pid = ready.stdout.trim().split(' ').pop();

  const held = await run(['bash', '-c', `pgrep -L -F ${PIDFILE}`], { cwd: '/tmp' });
  assert.doesNotMatch(held.stderr, /Locking check for pidfile failed/, `pgrep's flock(LOCK_SH|LOCK_NB) was granted while perl ${pid} held LOCK_EX: the shim's flock does not reach the kernel`);
  assert.equal(held.status, 0, `pgrep -L -F with the lock held: rc=${held.status} ${held.stdout}${held.stderr}`);
  assert.equal(held.stdout.trim(), pid, `pgrep -L -F names the holder: ${held.stdout}`);

  const kill = await run(['bash', '-c', `kill ${pid}; for i in $(seq 50); do kill -0 ${pid} 2>/dev/null || exit 0; sleep 0.1; done; exit 1`], { cwd: '/tmp' });
  assert.equal(kill.status, 0, `perl ${pid} did not exit: ${kill.stderr}`);
  const freed = await run(['bash', '-c', `pgrep -L -F ${PIDFILE}; echo rc=$?`], { cwd: '/tmp' });
  assert.match(freed.stderr, /Locking check for pidfile failed/, `with the holder gone the pidfile is unlocked: ${freed.stdout}${freed.stderr}`);
  assert.match(freed.stdout, /rc=1\s*$/, freed.stdout);
}
