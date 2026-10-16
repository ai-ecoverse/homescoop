export default async function subprocess(ctx) {
  const { assert } = ctx;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const run = (argv, stdin) => Promise.race([
    ctx.run(argv, { cwd: '/home', stdin }),
    sleep(20000).then(() => ({ status: 'no exit within 20 s', stdout: '', stderr: '' })),
  ]);
  for (const argv of [
    ['websocat', '-s', '18110', 'cmd:tr a-z A-Z'],
    ['websocat', 'ws-l:127.0.0.1:18111', 'exec:cat'],
    ['websocat', '-b', 'ws://127.0.0.1:18112/', 'sh-c:cat'],
  ]) {
    const r = await run(argv, 'hello\n');
    const out = `${r.stdout}${r.stderr}`;
    assert.notEqual(r.status, 0, `${argv.join(' ')} must fail: rc ${r.status}`);
    assert.equal(typeof r.status, 'number', `${argv.join(' ')}: ${r.status}`);
    assert.match(out, /exec:, cmd: and sh-c: are not supported on WASIX/, `${argv.join(' ')}: ${out}`);
    assert.doesNotMatch(out, /panicked at/, `${argv.join(' ')} must not panic: ${out}`);
  }
}
