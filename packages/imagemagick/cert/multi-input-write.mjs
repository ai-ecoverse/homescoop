const FATAL = /RuntimeError|Aborted|unreachable|memory access out of bounds|wasm trap|out of memory/i;
const MISSING = /unable to open image .missing\.png.: No such file or directory/;

export default async function multiInputWrite(ctx) {
  const { assert } = ctx;
  const cwd = '/tmp/multiwrite';
  await ctx.write(`${cwd}/.keep`, '');
  const run = (argv) => ctx.run(argv, { cwd });
  const what = async (f, format) => (await run(['magick', 'identify', '-format', format, f])).stdout;
  const ls = async () => (await run(['ls', '-A'])).stdout.split('\n').filter(Boolean).sort();
  for (const [f, size, color] of [['a.png', '10x10', 'red'], ['b.png', '10x10', 'blue'], ['a2.png', '10x10', 'red'], ['w.png', '9000x10', 'green'], ['wide.png', '17000x10', 'green'], ['pano.webp', '30x20', 'green']]) {
    const mk = await run(['magick', '-size', size, `xc:${color}`, f]);
    assert.equal(mk.status, 0, `${f}: ${mk.stderr}`);
  }
  const tiles = ['-geometry', '+0+0', '-tile', '2x1'];
  const TILED = '%m %w %h %[pixel:p{0,0}] %[pixel:p{15,5}]';
  const control = await run(['magick', 'montage', ...tiles, 'a.png', 'b.png', 'ok.png']);
  assert.equal(control.status, 0, `montage a.png b.png ok.png: rc ${control.status} ${control.stderr}`);
  assert.equal(control.stderr, '', 'montage without a failed input prints nothing');
  assert.equal(await what('ok.png', TILED), 'PNG 20 10 srgb(255,0,0) srgb(0,0,255)', 'montage tiles a.png and b.png side by side');

  const cases = [
    { out: 'm.png', format: TILED, status: 1, errors: [MISSING], argv: ['magick', 'montage', ...tiles, 'a.png', 'missing.png', 'b.png', 'm.png'] },
    { out: 'mk.png', format: TILED, status: 1, errors: [/keep/], argv: ['magick', 'montage', ...tiles, '.keep', 'a.png', 'b.png', 'mk.png'] },
    { out: 'o.png', format: '%m %w %h %[pixel:p{0,0}] %[pixel:p{7,5}]', status: 1, errors: [MISSING], argv: ['magick', 'composite', '-geometry', '+5+0', 'a.png', 'missing.png', 'b.png', 'o.png'] },
    { out: 'd.png', format: '%m %w %h', status: 2, errors: [/^0 \(0\)/, MISSING], argv: ['magick', 'compare', '-metric', 'AE', 'a.png', 'missing.png', 'a2.png', 'd.png'] },
  ];
  for (const c of cases) {
    const r = await run(c.argv);
    assert.equal(r.status, c.status, `${c.argv.join(' ')}: rc ${r.status} ${r.stderr}`);
    for (const re of c.errors) assert.match(r.stderr, re, `${c.argv.join(' ')}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, FATAL);
  }
  const written = {};
  for (const c of cases) written[c.out] = await what(c.out, c.format);
  assert.deepEqual(written, {
    'm.png': 'PNG 20 10 srgb(255,0,0) srgb(0,0,255)',
    'mk.png': 'PNG 20 10 srgb(255,0,0) srgb(0,0,255)',
    'o.png': 'PNG 10 10 srgb(0,0,255) srgb(255,0,0)',
    'd.png': 'PNG 10 10',
  }, 'montage, composite and compare write their output after one failed input (homescoop#2219: the failed read left its error pending, and the write was then discarded)');

  for (const cmd of [['magick', 'identify'], ['identify']]) {
    const r = await run([...cmd, '-format', '%f %w %h\n', 'missing.png', 'm.png', '.keep', 'o.png', 'd.png']);
    assert.equal(r.stdout, 'm.png 20 10\no.png 10 10\nd.png 10 10\n', `${cmd.join(' ')} missing.png m.png .keep o.png d.png lists the three outputs (homescoop#2218, #2219): ${r.stdout}${r.stderr}`);
    assert.equal(r.status, 1, `rc ${r.status} ${r.stderr}`);
    assert.match(r.stderr, MISSING, r.stderr);
    assert.match(r.stderr, /keep/, r.stderr);
    assert.doesNotMatch(r.stderr, FATAL);
  }

  const before = await ctx.readBytes(`${cwd}/pano.webp`);
  for (const argv of [
    ['magick', 'montage', ...tiles, 'w.png', 'missing.png', 'w.png', 'pano.webp'],
    ['magick', 'montage', ...tiles, 'w.png', 'missing.png', 'w.png', 'new.webp'],
    ['magick', 'composite', 'a.png', 'missing.png', 'wide.png', 'pano.webp'],
  ]) {
    const r = await run(argv);
    assert.equal(r.status, 1, `${argv.join(' ')}: rc ${r.status} ${r.stderr}`);
    assert.match(r.stderr, MISSING, r.stderr);
    assert.match(r.stderr, /width or height exceeds limit/, `the write itself fails and is reported: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, FATAL);
  }
  const after = await ctx.readBytes(`${cwd}/pano.webp`);
  assert.ok(before !== null && after !== null && Buffer.compare(before, after) === 0, 'a write that fails after a failed input leaves pano.webp as it was');
  assert.equal(await ctx.readBytes(`${cwd}/new.webp`), null, 'and creates no new.webp');
  assert.deepEqual(await ls(), ['.keep', 'a.png', 'a2.png', 'b.png', 'd.png', 'm.png', 'mk.png', 'o.png', 'ok.png', 'pano.webp', 'w.png', 'wide.png'], 'no temporary file is left beside any target');
  console.log('multi-input-write: montage (a missing file or a non-image among the inputs), composite and compare with a missing input write their output and exit 1 (compare 2) naming it (homescoop#2219); identify lists those outputs past a missing file and .keep (homescoop#2218); a montage or composite whose own WebP write fails after a missing input keeps pano.webp, creates no new.webp and leaves no temporary file');
}
