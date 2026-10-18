/**
 * wasix-python 3.14.2-14 (wasix-sysroot -21: termios, window size and isatty
 * per descriptor through slicc-kernel's slicc_tty, 1.48.0+): in a pty,
 * os.get_terminal_size is the pty's, tty.setraw is really raw (^C arrives as
 * byte 3, no KeyboardInterrupt) and the saved termios restores. On pipes,
 * os.get_terminal_size and isatty say no. -13 (sysroot -20) kept ISIG and
 * answered 80x24 for a pipe.
 */
const SCRIPT = String.raw`
import os, sys, termios, tty
print("size", tuple(os.get_terminal_size(0)), os.isatty(0), flush=True)
old = termios.tcgetattr(0)
tty.setraw(0)
cur = termios.tcgetattr(0)
print("raw", bool(cur[3] & termios.ISIG), bool(cur[3] & termios.ICANON), bool(cur[1] & termios.OPOST), end="\r\n", flush=True)
print("ready", end="\r\n", flush=True)
try:
    b = os.read(0, 1)
    got = b[0]
except KeyboardInterrupt:
    got = "KeyboardInterrupt"
termios.tcsetattr(0, termios.TCSAFLUSH, old)
back = termios.tcgetattr(0)
print("read", got, "restored", bool(back[3] & termios.ISIG), bool(back[3] & termios.ICANON), flush=True)
`;
const PIPES = String.raw`
import os, errno
try:
    os.get_terminal_size(0); print("size ok")
except OSError as e:
    print("size", errno.errorcode.get(e.errno))
print("isatty", os.isatty(0), os.isatty(1))
`;

export default async function (ctx) {
  const { run, pty, write, assert } = ctx;
  await write('/tmp/tty_check.py', SCRIPT);
  await write('/tmp/tty_pipes.py', PIPES);
  const t = await pty(['python3', '/tmp/tty_check.py'], {
    cols: 100,
    rows: 30,
    cwd: '/tmp',
    steps: [{ expect: 'ready' }, { write: '\x03' }, { expect: 'restored' }],
    timeoutMs: 15000,
  });
  assert.ok(!t.failedStep, `stuck at ${JSON.stringify(t.failedStep)}:\n${t.out}`);
  assert.match(t.out, /size \(100, 30\) True/, t.out);
  assert.match(t.out, /raw False False False/, t.out);
  assert.match(t.out, /read 3 restored True True/, t.out);
  const p = await run(['bash', '-c', 'echo | python3 /tmp/tty_pipes.py | cat'], { cwd: '/tmp' });
  assert.equal(p.status, 0, `${p.stdout}${p.stderr}`);
  assert.deepEqual(p.stdout.trim().split('\n'), ['size ENOTTY', 'isatty False False'], p.stdout);
}
