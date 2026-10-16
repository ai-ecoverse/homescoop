// homescoop#585, webp-check-size-before-open.patch: WebP holds at most
// 16383 px a side. Upstream's WriteWEBPImage opened (truncated) the output
// before refusing a wider image, so writing a too-wide image over an existing
// .webp, the input itself included, destroyed it. The patch refuses first.
const FATAL = /RuntimeError|Aborted|unreachable|memory access out of bounds|wasm trap|out of memory/i;

export default async function webpInplace(ctx) {
  const { assert } = ctx;
  const cwd = '/tmp/webp585';
  await ctx.write(`${cwd}/.keep`, '');
  const run = (argv) => ctx.run(argv, { cwd });
  const ok = async (argv) => {
    const r = await run(argv);
    assert.equal(r.status, 0, `${argv.join(' ')}: rc ${r.status} ${r.stderr}`);
    return r;
  };
  const what = async (f) => (await run(['identify', '-format', '%m %w %h', f])).stdout;
  const refused = async (argv, file, before) => {
    const r = await run(argv);
    assert.equal(r.status, 1, `${argv.join(' ')}: rc ${r.status} ${r.stderr}`);
    assert.match(r.stderr, /width or height exceeds limit/, `${argv.join(' ')}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, FATAL);
    assert.equal(await what(file), before, `${file} after the refused write (homescoop#585: truncated)`);
  };

  // In place: the input is the output.
  await ok(['magick', '-size', '9000x100', 'gradient:red-blue', 'w.webp']);
  assert.equal(await what('w.webp'), 'WEBP 9000 100');
  await refused(['magick', 'w.webp', '-resize', '200%', 'w.webp'], 'w.webp', 'WEBP 9000 100');

  // A panorama the 64KP tab policy reads (18000x3000) written over an existing .webp.
  await ok(['magick', '-size', '300x200', 'xc:green', 'pano.webp']);
  await ok(['magick-open', '-size', '18000x3000', 'gradient:blue-green', '-quality', '85', 'pano.jpg']);
  await refused(['magick', 'pano.jpg', 'pano.webp'], 'pano.webp', 'WEBP 300 200');
  await refused(['magick', '-size', '100x17000', 'xc:blue', 'pano.webp'], 'pano.webp', 'WEBP 300 200');

  // magick-open (upstream's open policy) the same.
  await ok(['magick', '-size', '64x64', 'xc:red', 'keep.webp']);
  await refused(['magick-open', '-size', '17000x100', 'xc:blue', 'keep.webp'], 'keep.webp', 'WEBP 64 64');

  // No output file is created when there was none.
  const fresh = await run(['magick', '-size', '16384x10', 'xc:white', 'new.webp']);
  assert.equal(fresh.status, 1, `16384x10 to new.webp: rc ${fresh.status}`);
  assert.equal((await run(['identify', 'new.webp'])).status, 1, 'no new.webp after a refused write');

  // At the limit it still writes.
  await ok(['magick', '-size', '16383x10', 'xc:white', 'edge.webp']);
  assert.equal(await what('edge.webp'), 'WEBP 16383 10');
  // A wide image resized to the limit writes (17000x1000, small enough that
  // source and result fit the tab policy's memory together).
  await ok(['magick-open', '-size', '17000x1000', 'gradient:blue-green', 'wide.jpg']);
  await ok(['magick', 'wide.jpg', '-resize', '16383x', 'wide.webp']);
  assert.equal(await what('wide.webp'), 'WEBP 16383 964');
  console.log('inplace-webp: over 16383 px refused before the output is opened (in place, over a panorama target, magick-open), no new file; 16383 px writes');
}
