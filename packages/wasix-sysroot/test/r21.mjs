/**
 * wasix-sysroot 2025.9.30-21: test/r21.c. Needs slicc-kernel with slicc_tty
 * (slicc-kernel#289). On -20 (the negative, NEGATIVE.md) a pipe or a file
 * answers TIOCGWINSZ with 80x24 and tcgetattr with success, and cfmakeraw
 * keeps ISIG/OPOST: ^C still raises SIGINT.
 */
export default async function (ctx) {
  const { run, pty, assert } = ctx;
  const t = await pty(['r21', 'tty'], {
    cols: 100,
    rows: 30,
    cwd: '/tmp',
    steps: [{ expect: 'ready' }, { write: '\x03' }, { sleepMs: 200 }, { write: 'q' }, { expect: 'r21 tty done' }],
    timeoutMs: 10000,
  });
  assert.ok(!t.failedStep, `stuck at ${JSON.stringify(t.failedStep)}:\n${t.out}`);
  const lines = t.out.split(/\r?\n/).map((l) => l.replace(/\r/g, '')).filter((l) => /^(tty|cooked|raw|read|restored):|^flush=/.test(l));
  assert.deepEqual(lines, [
    'tty: isatty=1,1 winsize=ok 100x30',
    'cooked: ICANON=1 ECHO=1 ISIG=1 OPOST=1',
    'raw: set=ok ICANON=0 ECHO=0 ISIG=0 IEXTEN=0 OPOST=0 ICRNL=0 VMIN=1',
    'read: n=1,1 bytes=3,113 sigints=0',
    'restored: ICANON=1 ECHO=1 ISIG=1 OPOST=1',
    'flush=0 drain=0',
  ], t.out);

  const p = await run(['bash', '-c', 'echo x | r21 pipes | cat'], { cwd: '/tmp' });
  assert.equal(p.status, 0, `${p.stdout}${p.stderr}`);
  assert.deepEqual(p.stdout.trim().split('\n'), [
    'stdin pipe: winsize=ENOTTY tcgetattr=ENOTTY isatty=0 errno=ENOTTY',
    'stdout pipe: winsize=ENOTTY tcgetattr=ENOTTY isatty=0 errno=ENOTTY',
    'file: winsize=ENOTTY tcgetattr=ENOTTY isatty=0 errno=ENOTTY',
    'closed: winsize=EBADF tcgetattr=EBADF isatty=0 errno=Bad file descriptor',
    'r21 pipes done',
  ], p.stdout);
}
