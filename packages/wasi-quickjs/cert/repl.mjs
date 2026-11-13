export default async function (ctx) {
  const { pty, assert } = ctx;
  const t = await pty(['qjs'], {
    cwd: '/home',
    cols: 80,
    steps: [
      { expect: 'qjs > ' },
      { write: '6*7\r' },
      { expect: '42' },
      { expect: 'qjs > ' },
      { write: '\x04' },
      { sleepMs: 300 },
      { write: 'os.platform\r' },
      { expect: 'wasi' },
      { expect: 'qjs > ' },
      { write: '.quit\r' },
    ],
  });
  assert.equal(t.failedStep, undefined, `pty step ${JSON.stringify(t.failedStep)}: ${JSON.stringify(t.out)}`);
  assert.equal(t.status, 0, JSON.stringify(t));
  assert.match(t.out, /^QuickJS-ng - Type "\.help" for help\r\n/, JSON.stringify(t.out));
  console.log('repl: on a terminal qjs is the REPL (cooked mode: no ttySetRaw on WASI); ^D does not end it, .quit does');
}
