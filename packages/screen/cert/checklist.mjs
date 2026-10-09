/**
 * screen checklist (homescoop#123, PR #136): -v, -ls with no sessions, a
 * detached session (-dmS) that -ls lists and -X quit ends, and an
 * interactive bash inside screen on a real pty (ctx.pty), and the window's
 * fork + exec keeping the pid (slicc-kernel#176): the program in the window
 * is the screen server's child, under a pid the kernel knows. screen needs
 * the realm user from /etc/passwd (slicc_pwd.c); without it every case but
 * -v fails with "getpwuid() can't identify your account!".
 */
export default async function (ctx) {
  const { run, pty, assert } = ctx;
  const cwd = '/home/screen';
  const go = (argv) => run(argv, { cwd });
  const mk = await run(['mkdir', '-p', cwd], { cwd: '/home' });
  assert.equal(mk.status, 0, `mkdir stderr=${mk.stderr}`);

  const ver = await go(['screen', '-v']);
  assert.equal(ver.status, 0);
  assert.match(ver.stdout, /^Screen version 5\.0\.1 \(build on [0-9-]+ [0-9:]+\) \n$/);

  // No sessions yet: rc 1 and the socket directory.
  const none = await go(['screen', '-ls']);
  assert.equal(none.status, 1, `-ls rc=${none.status} out=${JSON.stringify(none.stdout)}`);
  assert.equal(none.stdout, 'No Sockets found in /tmp/screens.\n\r\n');

  // Detached session: started, listed, quit by name, gone.
  const start = await go(['screen', '-dmS', 'hs', 'sleep', '30']);
  assert.equal(start.status, 0, `-dmS rc=${start.status} out=${JSON.stringify(start.stdout + start.stderr)}`);
  const one = await go(['screen', '-ls']);
  assert.equal(one.status, 0, `-ls (one) rc=${one.status}`);
  assert.match(one.stdout, /^There is a screen on:\r\n\t\d+\.hs\t\([^)]+\)\n1 Socket in \/tmp\/screens\.\r\n$/);
  const quit = await go(['screen', '-S', 'hs', '-X', 'quit']);
  assert.equal(quit.status, 0, `-X quit rc=${quit.status} out=${JSON.stringify(quit.stdout + quit.stderr)}`);
  const gone = await go(['screen', '-ls']);
  assert.equal(gone.status, 1);
  assert.equal(gone.stdout, 'No Sockets found in /tmp/screens.\n\r\n');

  // The window: screen forks and execs the program. With exec keeping the
  // pid, its parent is the screen server (the pid -ls shows), and its own
  // pid is real: /proc/<pid> is the program (bash exec'd its last command,
  // sleep, under the same pid).
  const ids = await go(['bash', '-c', [
    'screen -dmS w bash --norc -c "echo \\$PPID \\$\\$ > /home/screen/ids; sleep 20"',
    'for i in 1 2 3 4 5 6 7 8 9 10; do [ -s /home/screen/ids ] && break; sleep 0.2; done',
    'screen -ls; read ppid self < /home/screen/ids; echo "ids $ppid $self"',
    'echo "cmd $(tr "\\0" " " < /proc/$self/cmdline)"',
    'screen -S w -X quit',
  ].join('; ')]);
  assert.equal(ids.status, 0, `window ids rc=${ids.status} stderr=${ids.stderr}`);
  const server = Number(/^\t(\d+)\.w\t/m.exec(ids.stdout)?.[1]);
  const [, ppid, self] = /^ids (\d+) (\d+)$/m.exec(ids.stdout) ?? [];
  assert.ok(server > 0, `no session in ${JSON.stringify(ids.stdout)}`);
  assert.equal(Number(ppid), server, `window's parent is not the screen server: ${JSON.stringify(ids.stdout)}`);
  assert.match(ids.stdout, /^cmd sleep 20 $/m, `/proc/${self} is not the window program: ${JSON.stringify(ids.stdout + ids.stderr)}`);

  // Interactive: bash inside screen on a pty, a command, exit.
  const s = await pty(['screen', 'bash', '--norc', '-i'], {
    cwd,
    steps: [
      { expect: 'bash-5\\.3\\$ ' },
      { write: 'echo in-$((6*7))\r' },
      { expect: 'in-42' },
      { expect: 'bash-5\\.3\\$ ', write: 'exit\r' },
    ],
    timeoutMs: 10000,
  });
  assert.equal(s.status, 0, `pty status=${s.status} failed=${JSON.stringify(s.failedStep)} out=${JSON.stringify(s.out.slice(-300))}`);
  assert.match(s.out, /\x1b\[\?1049h/, 'screen switches to the alternate screen');
  assert.match(s.out, /\[screen is terminating\]\r\n$/);
}
