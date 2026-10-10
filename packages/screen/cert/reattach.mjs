/**
 * screen: reattach from a different terminal (homescoop#162). The screen
 * server opens the attaching terminal's device by path (screen passes the
 * fd with SCM_RIGHTS on Linux, which slicc-kernel's sockets cannot carry).
 * Up to 1.34.1 slicc-kernel hid other terminals' /dev/ttyN from a process
 * (slicc-kernel#192), so the attach was refused. 1.35.1 (#210) shows every
 * terminal under /dev: terminal B's device is visible from inside the
 * session, `screen -r` attaches, the window still holds terminal A's
 * output, a command runs, and screen terminates cleanly.
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
  assert.ok(!b.failedStep, `terminal B failed at ${JSON.stringify(b.failedStep)} out=${JSON.stringify(b.out.slice(-400))}`);
  assert.doesNotMatch(vis, /No such file|cannot access/, `terminal B's device is not visible from the session: ${JSON.stringify(vis)}`);
  assert.match(b.out, /sty=\[\d+\.ra\]/, `screen -r did not attach: ${JSON.stringify(b.out.slice(-400))}`);
  // The redrawn window is terminal A's: its earlier output is on screen.
  const afterAttach = b.out.slice(b.out.indexOf('screen -r ra'));
  assert.match(afterAttach, /first-2/, `reattached window lost A's output: ${JSON.stringify(afterAttach.slice(0, 400))}`);
  assert.match(b.out, /\[screen is terminating\]/, 'reattached screen did not terminate cleanly');
  const gone = await run(['screen', '-ls'], { cwd });
  assert.match(gone.stdout, /No Sockets found/, `session left behind: ${JSON.stringify(gone.stdout)}`);
}
