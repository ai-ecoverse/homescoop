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

  // A sleep of its own (pattern unlike checklist.mjs's), seen by pgrep before
  // pkill runs, so pkill cannot race the background child's exec. The polling
  // loops match "slee[p] 101" so they don't find their own command line.
  const start = await run(['bash', '-c', 'sleep 101 & echo $!'], { cwd: '/home' });
  assert.equal(start.status, 0, `sleep 101 & stderr=${start.stderr}`);
  const pid = start.stdout.trim();
  const seen = await run(
    ['bash', '-c', 'for i in $(seq 20); do pgrep -f "slee[p] 101" && exit 0; sleep 0.1; done; exit 1'],
    { cwd: '/home' },
  );
  assert.equal(seen.status, 0, `sleep 101 (pid ${pid}) never showed up`);

  // `bash -c 'cmd'` execs pkill; it must kill sleep, not itself (rc 0).
  const kill = await run(['bash', '-c', 'exec pkill -f "sleep 101"'], { cwd: '/home' });
  assert.equal(kill.status, 0, `pkill -f killed itself? rc=${kill.status} stderr=${kill.stderr}`);
  const gone = await run(
    ['bash', '-c', 'for i in $(seq 20); do pgrep -f "slee[p] 101" || exit 0; sleep 0.1; done; exit 1'],
    { cwd: '/home' },
  );
  assert.equal(gone.status, 0, `sleep 101 still running after pkill: ${gone.stdout}`);
}
