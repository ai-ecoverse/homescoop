export default async function (ctx) {
  const { run, pty, assert } = ctx;
  const show = (r) => `rc=${r.status}\n--- stdout\n${JSON.stringify(r.stdout ?? r.out)}\n--- stderr\n${JSON.stringify(r.stderr)}`;

  const v = await run(['picocom', '--version'], { cwd: '/root' });
  assert.equal(v.status, 0, show(v));
  assert.equal(v.stdout, 'picocom v2024-07\n', show(v));

  const h = await run(['picocom', '--help'], { cwd: '/root' });
  assert.equal(h.status, 0, show(h));
  assert.match(h.stdout, /^picocom v2024-07\n\nCompiled-in options:\n  TTY_Q_SZ is 0\n  HIGH_BAUD is enabled\n\nUsage is: picocom \[options\] <tty port device>/, show(h));
  assert.doesNotMatch(h.stdout, /USE_FLOCK|LINENOISE|USE_CUSTOM_BAUD|UUCP_LOCK_DIR/);
  assert.match(h.stdout, /--<b>aud <baudrate>/);
  assert.match(h.stdout, /--<X>it/);

  const send = await run(['picocom', '--send-cmd', 'sz', '/dev/ttyUSB0'], { cwd: '/root' });
  assert.notEqual(send.status, 0, show(send));
  assert.match(send.stderr, /Calling external programs is disabled/, show(send));

  const missing = await run(['picocom', '-b', '115200', '/dev/ttyUSB0'], { cwd: '/root' });
  assert.equal(missing.status, 1, show(missing));
  assert.match(missing.stderr, /FATAL: cannot open \/dev\/ttyUSB0: No such file or directory/, show(missing));

  const term = await pty(['picocom', '-b', '115200', '/dev/ttyACM0'], { cwd: '/root', steps: [{ expect: 'FATAL: cannot open /dev/ttyACM0: No such file or directory' }] });
  assert.equal(term.status, 1, `pty: ${JSON.stringify(term)}`);
  console.log('picocom checklist: --version, --help, --send-cmd refused, a missing node is ENOENT (pipe and pty)');
}
