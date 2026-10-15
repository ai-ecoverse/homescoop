export default async function roundtrip(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: 'cone' });
  const cwd = '/home/cone';
  const run = (argv) => ctx.run(argv, { cwd, user: 'cone' });
  const big = Array.from({ length: 4096 }, (_, i) => `line ${String(i).padStart(5, '0')} of the zip cert\n`).join('').slice(0, 65536);
  await ctx.write('/tmp/zc/src/a.txt', 'hello zip\n');
  await ctx.write('/tmp/zc/src/sub/b.txt', 'nested\n');
  await ctx.write('/tmp/zc/src/big.txt', big);
  const made = await run(['zip', '-r', 'out.zip', '/tmp/zc/src']);
  assert.equal(made.status, 0, `zip -r: rc ${made.status}\n${made.stdout}${made.stderr}`);
  assert.match(made.stdout, /adding: tmp\/zc\/src\/big\.txt \(deflated \d+%\)/);
  const list = await run(['unzip', '-l', 'out.zip']);
  assert.equal(list.status, 0, list.stderr);
  for (const name of ['tmp/zc/src/a.txt', 'tmp/zc/src/sub/b.txt', 'tmp/zc/src/big.txt']) {
    assert.match(list.stdout, new RegExp(`\\s${name.replace(/\./g, '\\.')}\\n`), `unzip -l lists ${name}`);
  }
  assert.match(list.stdout, /\s65536\s.*big\.txt/);
  const test = await run(['unzip', '-t', 'out.zip']);
  assert.equal(test.status, 0, test.stdout + test.stderr);
  assert.match(test.stdout, /No errors detected in compressed data of out\.zip\./);
  const pipe = await run(['unzip', '-p', 'out.zip', 'tmp/zc/src/big.txt']);
  assert.equal(pipe.status, 0, pipe.stderr);
  assert.equal(pipe.stdout, big, 'unzip -p returns the original bytes');
  const ex = await run(['unzip', '-o', '-d', 'x', 'out.zip']);
  assert.equal(ex.status, 0, ex.stdout + ex.stderr);
  assert.equal(await ctx.read('/home/cone/x/tmp/zc/src/a.txt'), 'hello zip\n');
  assert.equal(await ctx.read('/home/cone/x/tmp/zc/src/sub/b.txt'), 'nested\n');
  assert.equal(await ctx.read('/home/cone/x/tmp/zc/src/big.txt'), big);
  const missing = await run(['unzip', '-l', 'nothere.zip']);
  assert.equal(missing.status, 9, `missing archive: rc ${missing.status}`);
  assert.match(missing.stderr, /cannot find or open nothere\.zip/);
}
