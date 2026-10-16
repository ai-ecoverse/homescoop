// homescoop#432 with no shell: only wasm-zip is installed, so there is no
// /bin/sh for popen()/system(). Run by cert/meta.json's ci (run.mjs --cert).
export default async function ztestNoShell(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: 'cone' });
  const run = (argv) => ctx.run(argv, { cwd: '/home/cone', user: 'cone' });
  const sh = await run(['sh', '-c', 'true']);
  assert.notEqual(sh.status, 0, 'no shell is installed');
  await ctx.write('/tmp/zc-ns/a.txt', 'no shell here\n');
  const t = await run(['zip', '-T', 'ns.zip', '/tmp/zc-ns/a.txt']);
  assert.equal(t.status, 0, `zip -T: rc ${t.status}\n${t.stdout}${t.stderr}`);
  assert.match(t.stdout, /test of ns\.zip OK/);
  assert.doesNotMatch(t.stderr, /unzip pipe error|could not spawn unzip/);
  const v = await run(['zip', '-T', '-v', 'ns.zip', '/tmp/zc-ns/a.txt']);
  assert.equal(v.status, 0, `zip -T -v: rc ${v.status}\n${v.stdout}${v.stderr}`);
  assert.match(v.stdout, /testing: tmp\/zc-ns\/a\.txt\s+OK/);
  // -T -m: cone's own copy (unzip makes it) goes once the test passes.
  const x = await run(['unzip', '-d', 'x', 'ns.zip']);
  assert.equal(x.status, 0, x.stdout + x.stderr);
  assert.equal(await ctx.read('/home/cone/x/tmp/zc-ns/a.txt'), 'no shell here\n');
  const m = await run(['zip', '-T', '-m', 'm.zip', 'x/tmp/zc-ns/a.txt']);
  assert.equal(m.status, 0, `zip -T -m: rc ${m.status}\n${m.stdout}${m.stderr}`);
  assert.match(m.stdout, /test of m\.zip OK/);
  assert.equal(await ctx.read('/home/cone/x/tmp/zc-ns/a.txt'), null, 'zip -T -m removed the file');
  const p = await run(['unzip', '-p', 'm.zip', 'x/tmp/zc-ns/a.txt']);
  assert.equal(p.stdout, 'no shell here\n');
}
