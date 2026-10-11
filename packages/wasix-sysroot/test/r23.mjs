export default async function (ctx) {
  const { run, pty, assert } = ctx;
  const t = await pty(['r23', 'tty'], {
    cols: 100,
    rows: 30,
    cwd: '/tmp',
    steps: [{ expect: 'r23 tty done' }],
    timeoutMs: 10000,
  });
  assert.ok(!t.failedStep, `stuck at ${JSON.stringify(t.failedStep)}:\n${t.out}`);
  const p = await run(['bash', '-c', 'echo x | r23 pipes | cat'], { cwd: '/tmp' });
  assert.equal(p.status, 0, `${p.stdout}${p.stderr}`);
  const ttyLines = t.out.split(/\r?\n/).map((l) => l.replace(/\r/g, '')).filter((l) => /^(headers|tty)/.test(l));
  assert.deepEqual([...ttyLines, ...p.stdout.trim().split('\n')], [
    'headers: TIOCGWINSZ=0x101 TIOCSWINSZ=0x102',
    'tty wasix: get=ok 100x30 set=ok',
    'tty linux: get=ok 100x30 set=ok',
    'tty out wasix: get=ok 100x30 set=ok',
    'tty out linux: get=ok 100x30 set=ok',
    'headers: TIOCGWINSZ=0x101 TIOCSWINSZ=0x102',
    'stdin pipe wasix: get=ENOTTY 0x0 set=ENOTTY',
    'stdin pipe linux: get=ENOTTY 0x0 set=ENOTTY',
    'stdout pipe wasix: get=ENOTTY 0x0 set=ENOTTY',
    'stdout pipe linux: get=ENOTTY 0x0 set=ENOTTY',
    'file wasix: get=ENOTTY 0x0 set=ENOTTY',
    'file linux: get=ENOTTY 0x0 set=ENOTTY',
    'closed wasix: get=EBADF 0x0 set=EBADF',
    'closed linux: get=EBADF 0x0 set=EBADF',
    'r23 pipes done',
  ], `${t.out}\n${p.stdout}`);
  console.log('r23: TIOCGWINSZ/TIOCSWINSZ under 0x101/0x102 and 0x5413/0x5414 agree on a pty, pipes, a file and a closed fd');
}
