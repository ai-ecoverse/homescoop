/**
 * screen: reattach from a different terminal (homescoop#162). The screen
 * server opens the attaching terminal's device by path (screen passes the
 * fd with SCM_RIGHTS on Linux, which slicc-kernel's sockets cannot carry).
 * slicc-kernel up to at least 1.30.0 hides other terminals' /dev/ttyN from a
 * process (slicc-kernel#192), so the attach is refused and `screen -r`
 * returns 0 with the session still Detached.
 *
 * The case measures both: whether the attaching terminal's device is
 * visible from inside the session, and whether `screen -r` attached. They
 * must agree: invisible → not attached (the documented limit), visible →
 * attached, a command runs in the window, and screen terminates cleanly.
 */
export default async function (ctx) {
  const { run, pty, assert } = ctx;
  const cwd = '/home/screen-ra';
  await run(['mkdir', '-p', cwd], { cwd: '/home' });
  await run(['rm', '-f', '/tmp/ra-vis'], { cwd: '/home' });

  // Terminal A: start a session, run something, detach (C-a d).
  const a = await pty(['screen', '-S', 'ra', 'bash', '--norc', '-i'], {
    cwd,
    steps: [
      { expect: 'bash-5\\.3\\$ ' },
      { write: 'echo first-$((1+1))\r' },
      { expect: 'first-2' },
      { expect: 'bash-5\\.3\\$ ', write: '\x01d' },
      { expect: '\\[detached from \\d+\\.ra\\]' },
    ],
    timeoutMs: 10000,
  });
  assert.equal(a.status, 0, `detach status=${a.status} failed=${JSON.stringify(a.failedStep)} out=${JSON.stringify(a.out.slice(-300))}`);
  const ls = await run(['screen', '-ls'], { cwd });
  assert.match(ls.stdout, /\t\d+\.ra\t\(Detached\)/, `-ls after detach: ${JSON.stringify(ls.stdout)}`);

  // Terminal B: is B's device visible from inside the session? Then reattach,
  // and report $STY: set only inside a screen window.
  const b = await pty(['bash', '--norc', '-i'], {
    cwd,
    steps: [
      { expect: 'bash-5\\.3\\$ ' },
      { write: 't=$(tty); screen -S ra -X stuff "ls $t >/tmp/ra-vis 2>&1; echo vis-done >>/tmp/ra-vis"$\'\\r\'; sleep 1; cat /tmp/ra-vis\r' },
      { expect: 'vis-done' },
      { expect: 'bash-5\\.3\\$ ', write: 'screen -r ra\r' },
      { sleepMs: 1500, write: 'echo "sty=[$STY]"\r' },
      { expect: 'sty=\\[' },
      { sleepMs: 300, write: 'exit\r' },
      { sleepMs: 800, write: 'exit\r' },
    ],
    timeoutMs: 8000,
  });
  const vis = (await run(['cat', '/tmp/ra-vis'], { cwd })).stdout;
  const visible = !/No such file|cannot access/.test(vis);
  const attached = /sty=\[\d+\.ra\]/.test(b.out);
  assert.ok(!b.failedStep, `terminal B failed at ${JSON.stringify(b.failedStep)} out=${JSON.stringify(b.out.slice(-400))}`);
  assert.equal(attached, visible,
    `attach (${attached}) and tty visibility from the session (${visible}) disagree: vis=${JSON.stringify(vis)} out=${JSON.stringify(b.out.slice(-400))}`);
  if (attached) {
    assert.match(b.out, /\[screen is terminating\]/, 'reattached screen did not terminate cleanly');
  } else {
    // The documented limit: no attach, the session is still there, Detached.
    const still = await run(['screen', '-ls'], { cwd });
    assert.match(still.stdout, /\t\d+\.ra\t\(Detached\)/, `session lost: ${JSON.stringify(still.stdout)}`);
    await run(['screen', '-S', 'ra', '-X', 'quit'], { cwd });
  }
}
