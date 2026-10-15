export default async function loopback(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: 'cone' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const run = (argv, stdin, ms = 30000) => Promise.race([
    ctx.run(argv, { cwd: '/home/cone', user: 'cone', stdin }),
    sleep(ms).then(() => ({ status: `no exit within ${ms} ms`, stdout: '', stderr: '' })),
  ]);
  const server = ctx.run(['websocat', '--global-timeout-ms', '90000', '--global-timeout-force-exit', '-s', '18080', 'mirror:'], { cwd: '/home/cone', user: 'cone' }).catch((e) => ({ error: String(e) }));
  await sleep(1500);
  const url = 'ws://127.0.0.1:18080/';

  const one = await run(['websocat', url], 'hello ws\n');
  assert.equal(one.status, 0, one.stdout + one.stderr);
  assert.equal(one.stdout, 'hello ws\n');
  const lines = await run(['websocat', url], 'one\ntwo\nthree\n');
  assert.equal(lines.stdout, 'one\ntwo\nthree\n', 'text lines echo in order');

  for (const mib of [1, 16]) {
    const data = `${'0123456789abcdef'.repeat(64)}\n`.repeat(mib * 1024);
    const t0 = Date.now();
    const r = await run(['websocat', '-b', url], data);
    assert.equal(r.status, 0, `${mib} MiB: rc ${r.status} ${r.stderr}`);
    assert.equal(r.stdout.length, data.length, `${mib} MiB: length`);
    assert.ok(r.stdout === data, `${mib} MiB binary round trip is byte-equal`);
    assert.ok(Date.now() - t0 < 30000, `${mib} MiB in ${Date.now() - t0} ms`);
  }

  const many = await Promise.all([0, 1, 2, 3, 4].map((i) => run(['websocat', url], `client ${i}\n`)));
  assert.deepEqual(many.map((r) => r.stdout), [0, 1, 2, 3, 4].map((i) => `client ${i}\n`), 'five concurrent clients');

  const refused = await run(['websocat', 'ws://127.0.0.1:18081/'], 'x\n');
  assert.equal(refused.status, 14);
  assert.match(refused.stdout + refused.stderr, /Connection refused \(os error 14\)/);

  const t0 = Date.now();
  const name = await run(['websocat', 'ws://example.com/'], 'x\n');
  assert.equal(name.status, 21, `hostname without an exit: rc ${name.status}`);
  assert.match(name.stdout + name.stderr, /os error 44/);
  const outer = await run(['websocat', 'ws://100.64.1.2:8080/'], 'x\n');
  assert.equal(outer.status, 14, `outer address without an exit: rc ${outer.status}`);
  assert.match(outer.stdout + outer.stderr, /Network unreachable/);
  assert.ok(Date.now() - t0 < 10000, 'no hang without an exit');

  const done = await Promise.race([server, sleep(100).then(() => null)]);
  assert.equal(done, null, 'the server is still serving');
}
