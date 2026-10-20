// What a plain magick call does in slicc without extra options (users enforce):
// - homescoop#586: text without -font uses the packaged default font (URW
//   Nimbus Sans as Helvetica, etc/fonts and type.xml); no fontconfig here.
// - homescoop#1208: MPC persists the pixel cache to disk, which the tab
//   policy's disk=0 forbids; the tab policy refuses MPC with its policy
//   message and leaves no file, and magick-open (disk allowed) writes and
//   reads it.
// - homescoop#679: identify's elapsed-time column is a real time. Before
//   timer-monotonic-emscripten.patch it read 4294967295:36.000 (an
//   uninitialized timespec from a CLOCK_MONOTONIC_RAW clock_gettime that
//   Emscripten refuses).
// - homescoop#561: a 48 MP JPEG 2000 encodes (jp2-tile-large.patch tiles
//   images above 16 MP), where the single tile used to exhaust the wasm heap.
const FATAL = /RuntimeError|Aborted|unreachable|memory access out of bounds|wasm trap|out of memory/i;

export default async function defaults(ctx) {
  const { assert } = ctx;
  const cwd = '/tmp/defaults';
  await ctx.write(`${cwd}/.keep`, '');
  const run = (argv) => ctx.run(argv, { cwd });
  const ok = async (argv) => {
    const r = await run(argv);
    assert.equal(r.status, 0, `${argv.join(' ')}: rc ${r.status} ${r.stderr}`);
    assert.doesNotMatch(r.stderr, FATAL);
    return r;
  };
  const fmt = async (f, spec = '%m %w %h') => (await run(['magick', 'identify', '-format', spec, f])).stdout;

  await ok(['magick', '-pointsize', '20', 'label:hi', 'l.png']);
  const [w, h] = (await fmt('l.png', '%w %h')).split(' ').map(Number);
  assert.ok(w > 5 && h > 5, `label:hi without -font is ${w}x${h}`);
  await ok(['magick', '-size', '300x100', 'xc:white', '-annotate', '+10+50', 'hi', 'a.png']);
  const mean = Number((await run(['magick', 'a.png', '-format', '%[fx:mean]', 'info:'])).stdout);
  assert.ok(mean < 1, `-annotate without -font drew nothing (mean ${mean})`);
  const fonts = await ok(['magick', '-list', 'font']);
  assert.match(fonts.stdout, /Font: Helvetica\n/, `the default font list: ${fonts.stdout.slice(0, 300)}`);

  const mpc = await run(['magick', '-size', '30x30', 'xc:red', 'out.mpc']);
  assert.equal(mpc.status, 1, `MPC under the tab policy: rc ${mpc.status} ${mpc.stderr}`);
  assert.match(mpc.stderr, /not authorized by the security policy `MPC'/, mpc.stderr);
  assert.equal(await ctx.readBytes(`${cwd}/out.mpc`), null, 'no out.mpc after the refusal');
  assert.equal(await ctx.readBytes(`${cwd}/out.cache`), null, 'no out.cache after the refusal');
  await ok(['magick-open', '-size', '30x30', 'xc:red', 'o.mpc']);
  await ok(['magick-open', 'o.mpc', 'o.png']);
  assert.equal(await fmt('o.png'), 'PNG 30 30', 'magick-open writes MPC and reads it back');

  const id = await ok(['magick', 'identify', 'rose:', 'logo:']);
  for (const line of id.stdout.trim().split('\n')) {
    const t = line.split(' ').pop();
    assert.match(t, /^0:\d{2}\.\d{3}$/, `identify's elapsed time: ${line}`);
  }

  await ok(['magick', '-size', '16000x3000', 'gradient:', 'g16.jp2']);
  assert.equal(await fmt('g16.jp2'), 'JP2 16000 3000', '48 MP JPEG 2000');
  console.log('defaults: label:/-annotate with the default font; MPC refused by the tab policy, written and read by magick-open; identify elapsed 0:ss.mmm; 16000x3000 JP2 encodes');
}
