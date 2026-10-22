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
  for (const f of ['o1.png', 'o2.png', 'o3.png']) {
    const mkO = await run(['magick', '-size', '40x20', 'xc:red', f]);
    assert.equal(mkO.status, 0, mkO.stderr);
  }
  const after = await run(['mogrify', '-resize', '50%', 'missing.png', 'o1.png', 'o2.png']);
  assert.equal(after.status, 1, `mogrify over missing.png o1.png o2.png exits 1: rc ${after.status} ${after.stderr}`);
  assert.match(after.stderr, /missing\.png/, `the failure names missing.png (homescoop#1655): ${after.stderr}`);
  assert.deepEqual([await size('o1.png'), await size('o2.png')], ['PNG 20 10', 'PNG 20 10'], `mogrify goes on after a missing first file: o1.png and o2.png resized (homescoop#1655): ${after.stderr}`);
  const mid = await run(['mogrify', '-resize', '50%', 'o1.png', 'missing.png', 'o3.png']);
  assert.equal(mid.status, 1, `mogrify over o1.png missing.png o3.png exits 1: rc ${mid.status} ${mid.stderr}`);
  assert.deepEqual([await size('o1.png'), await size('o3.png')], ['PNG 10 5', 'PNG 20 10'], `a missing file in the middle: o1.png and o3.png both resized (homescoop#1655): ${mid.stderr}`);
  const mkBig = await run(['magick', '-size', '1400x1000', 'gradient:', 'big.png']);
  assert.equal(mkBig.status, 0, mkBig.stderr);
  const bigBefore = await ctx.readBytes('/tmp/mog/big.png');
  const enc = await run(['mogrify', '-limit', 'memory', '24MiB', '-limit', 'map', '0', '-depth', '8', '-rotate', '90', 'big.png', 'o2.png', 'o3.png']);
  assert.equal(enc.status, 1, `mogrify with a failing encode first exits 1: rc ${enc.status} ${enc.stderr}`);
  assert.match(enc.stderr, /cache resources exhausted.*big\.png/, `the failure names big.png (homescoop#1655): ${enc.stderr}`);
  assert.ok(Buffer.compare(await ctx.readBytes('/tmp/mog/big.png'), bigBefore) === 0, 'big.png is unchanged after its failed encode');
  assert.deepEqual([await size('o2.png'), await size('o3.png')], ['PNG 10 20', 'PNG 10 20'], `mogrify goes on after a failed encode: o2.png and o3.png rotated (homescoop#1655): ${enc.stderr}`);
  const ls3 = await run(['magick', 'identify', '-format', '%f\n', '*']);
  assert.deepEqual(ls3.stdout.trim().split('\n').sort(), ['a.png', 'b.jpg', 'big.png', 'o1.png', 'o2.png', 'o3.png', 's.jpg', 's.png', 's.webp'], `no stray files after the failed files: ${ls3.stdout}`);
  console.log('mogrify: in place without -format/-path (a.png, b.jpg 400x300 -> 200x150); -format webp/jpg over existing targets writes WEBP/JPEG bytes (homescoop#624); after a missing or failed file mogrify goes on with the rest and exits 1 naming it (homescoop#1655)');
}
