export default async function mogrify(ctx) {
  const { assert } = ctx;
  await ctx.write('/tmp/mog/.keep', '');
  const run = (argv) => ctx.run(argv, { cwd: '/tmp/mog' });
  const size = async (f) => (await run(['magick', 'identify', '-format', '%m %w %h', f])).stdout;
  for (const f of ['a.png', 'b.jpg']) {
    const mk = await run(['magick', '-size', '400x300', 'gradient:red-blue', f]);
    assert.equal(mk.status, 0, mk.stderr);
  }
  const r = await run(['mogrify', '-resize', '50%', 'a.png', 'b.jpg']);
  assert.equal(r.status, 0, `mogrify in place: rc ${r.status} ${r.stderr}`);
  assert.equal(r.stderr, '', 'mogrify in place prints nothing');
  assert.equal(await size('a.png'), 'PNG 200 150', 'mogrify without -format/-path rewrites a.png in place (homescoop#353)');
  assert.equal(await size('b.jpg'), 'JPEG 200 150', 'and b.jpg');
  const ls = await run(['magick', 'identify', '-format', '%f\n', '*']);
  assert.deepEqual(ls.stdout.trim().split('\n').sort(), ['a.png', 'b.jpg'], `no stray files: ${ls.stdout}`);
  console.log('mogrify: in place without -format/-path (a.png, b.jpg 400x300 -> 200x150)');
}
