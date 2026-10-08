/**
 * pgrep/pkill -f don't match themselves after an exec (slicc-kernel#99).
 * `bash -c 'cmd'` execs its one command, so the tool runs as an exec'd image;
 * once getpid() agrees with /proc, it excludes itself as on Linux. Needs
 * wasm-bash with the kernel-execve shim (5.3.0-8).
 */
export default async function (ctx) {
  const { run, assert } = ctx;

  const none = await run(['bash', '-c', 'pgrep -f zz-hs99-no-such-process'], { cwd: '/home' });
  assert.equal(none.status, 1, `pgrep matched itself? rc=${none.status} out=${none.stdout}`);
  assert.equal(none.stdout, '');

  const kill = await run(['bash', '-c', 'sleep 100 & exec pkill -f "sleep 100"'], { cwd: '/home' });
  assert.equal(kill.status, 0, `pkill -f killed itself? rc=${kill.status} stderr=${kill.stderr}`);
  const left = await run(['pgrep', '-f', 'sleep 100'], { cwd: '/home' });
  assert.equal(left.status, 1, `sleep 100 still running: ${left.stdout}`);
}
