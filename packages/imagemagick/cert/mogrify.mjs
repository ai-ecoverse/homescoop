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
  // homescoop#624: -format over an existing target. mogrify writes to a
  // "<target>-xxxxxxxx~" backup first, a name with no format, so upstream
  // encoded the input's format under the new name. The patch makes it explicit.
  const MAGIC = { WEBP: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP', JPEG: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff };
  const mk = await run(['magick', '-size', '100x50', 'xc:red', 's.png']);
  assert.equal(mk.status, 0, mk.stderr);
  for (const [ext, fmt] of [['webp', 'WEBP'], ['jpg', 'JPEG']]) {
    const pre = await run(['magick', '-size', '10x10', 'xc:green', `s.${ext}`]);
    assert.equal(pre.status, 0, pre.stderr);
    const m = await run(['mogrify', '-format', ext, 's.png']);
    assert.equal(m.status, 0, `mogrify -format ${ext} s.png over an existing s.${ext}: rc ${m.status} ${m.stderr}`);
    assert.equal(await size(`s.${ext}`), `${fmt} 100 50`, `mogrify -format ${ext} over an existing s.${ext} (homescoop#624)`);
    const bytes = await ctx.readBytes(`/tmp/mog/s.${ext}`);
    assert.ok(bytes && MAGIC[fmt](bytes), `s.${ext} starts with ${bytes?.subarray(0, 12).toString('hex')}, not ${fmt} magic bytes (homescoop#624)`);
  }
  const ls2 = await run(['magick', 'identify', '-format', '%f\n', '*']);
  assert.deepEqual(ls2.stdout.trim().split('\n').sort(), ['a.png', 'b.jpg', 's.jpg', 's.png', 's.webp'], `no stray files after -format: ${ls2.stdout}`);
  console.log('mogrify: in place without -format/-path (a.png, b.jpg 400x300 -> 200x150); -format webp/jpg over existing targets writes WEBP/JPEG bytes (homescoop#624)');
}
