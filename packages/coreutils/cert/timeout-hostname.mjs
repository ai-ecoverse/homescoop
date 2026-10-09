/**
 * coreutils timeout and hostname (homescoop#88). In slicc, timeout spawns
 * the command, puts it in its own process group and polls it
 * (timeout-slicc.patch: no fork, no timer signals); hostname is built in.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const sh = async (script) => {
    const t0 = Date.now();
    const r = await run(['bash', '-c', script], { cwd: '/home' });
    return { ...r, secs: (Date.now() - t0) / 1000 };
  };
  const timed = async (argv) => {
    const t0 = Date.now();
    const r = await run(argv, { cwd: '/home' });
    return { ...r, secs: (Date.now() - t0) / 1000 };
  };

  // Times out: 124 after about one second, not five.
  const slow = await timed(['timeout', '1', 'sleep', '5']);
  assert.equal(slow.status, 124, `timeout 1 sleep 5 rc=${slow.status} stderr=${slow.stderr}`);
  assert.ok(slow.secs >= 0.8 && slow.secs < 4, `timeout 1 sleep 5 took ${slow.secs}s`);

  // Finishes in time: the command's own status, at once.
  const fast = await timed(['timeout', '5', 'true']);
  assert.equal(fast.status, 0, `timeout 5 true rc=${fast.status} stderr=${fast.stderr}`);
  assert.ok(fast.secs < 3, `timeout 5 true took ${fast.secs}s`);
  const code = await timed(['timeout', '5', 'bash', '-c', 'exit 3']);
  assert.equal(code.status, 3, `exit status passes through: rc=${code.status}`);

  // -s KILL: forcibly killed → 128+9.
  const kill = await timed(['timeout', '-s', 'KILL', '1', 'sleep', '5']);
  assert.equal(kill.status, 137, `timeout -s KILL rc=${kill.status} stderr=${kill.stderr}`);
  assert.ok(kill.secs < 4, `timeout -s KILL took ${kill.secs}s`);

  // --preserve-status: the command's signal status (TERM → 143).
  const keep = await timed(['timeout', '--preserve-status', '1', 'sleep', '5']);
  assert.equal(keep.status, 143, `--preserve-status rc=${keep.status}`);

  // -k: a command that ignores TERM gets KILL one second later.
  const stubborn = await timed(['timeout', '-k', '1', '1', 'bash', '-c', 'trap "" TERM; sleep 5']);
  assert.equal(stubborn.status, 137, `timeout -k rc=${stubborn.status} stderr=${stubborn.stderr}`);
  assert.ok(stubborn.secs >= 1.5 && stubborn.secs < 4.5, `timeout -k took ${stubborn.secs}s`);

  // The whole job goes, not just its leader: the background sleep of the
  // timed-out bash is dead too (its process group was signalled).
  const group = await sh(
    'rm -f /tmp/hs88-child; ' +
      'timeout 1 bash -c "sleep 30 & echo \\$! > /tmp/hs88-child; wait"; echo "rc=$?"; ' +
      'sleep 0.3; if kill -0 "$(cat /tmp/hs88-child)" 2>/dev/null; then echo alive; else echo gone; fi',
  );
  assert.equal(group.status, 0, `group case stderr=${group.stderr}`);
  assert.equal(group.stdout, 'rc=124\ngone\n', `group kill: ${JSON.stringify(group.stdout)}`);

  // A command that doesn't exist: 127 and a message, as GNU timeout.
  const missing = await timed(['timeout', '1', 'hs88-no-such-command']);
  assert.equal(missing.status, 127, `missing command rc=${missing.status}`);
  assert.match(missing.stderr, /failed to run command/);

  // Bad duration: usage error 125.
  const bad = await timed(['timeout', 'soon', 'true']);
  assert.equal(bad.status, 125, `bad duration rc=${bad.status}`);

  // hostname prints the kernel's node name, the same as uname -n.
  const host = await timed(['hostname']);
  const uname = await timed(['uname', '-n']);
  assert.equal(host.status, 0, `hostname stderr=${host.stderr}`);
  assert.equal(uname.status, 0, `uname -n stderr=${uname.stderr}`);
  assert.ok(host.stdout.trim().length > 0, 'hostname printed nothing');
  assert.equal(host.stdout, uname.stdout);
}
