const FONT = '/node_modules/@ai-ecoverse/wasm-poppler/share/fonts/n019003l.pfb';

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const ok = async (argv) => {
    const r = await run(argv, { cwd: '/tmp' });
    assert.equal(r.status, 0, `${argv.join(' ')}: rc=${r.status} ${r.stdout}${r.stderr}`);
    return r.stdout;
  };

  const version = await ok(['magick', '-version']);
  const builtIn = (version.match(/^Delegates \(built-in\): *(.*)$/m) ?? [])[1]?.trim().split(/\s+/) ?? [];
  for (const d of ['freetype', 'jpeg', 'jp2', 'lcms', 'png', 'tiff', 'webp', 'xml', 'zlib']) {
    assert.ok(builtIn.includes(d), `-version built-in delegates lack ${d}: ${builtIn.join(' ')}`);
  }

  const formats = await ok(['magick', '-list', 'format']);
  const mode = (name) => (formats.match(new RegExp(`^\\s*${name}\\*?\\s+(\\S+)\\s`, 'm')) ?? [])[1] ?? 'absent';
  assert.match(mode('WEBP'), /^rw/, `WEBP in -list format: ${mode('WEBP')}`);
  assert.match(mode('MSL'), /^r/, `MSL in -list format: ${mode('MSL')}`);
  assert.match(mode('MSVG'), /^r/, `MSVG (libxml2) in -list format: ${mode('MSVG')}`);
  assert.match(mode('TTF'), /^r/, `TTF (freetype) in -list format: ${mode('TTF')}`);

  await ok(['magick', 'logo:', '-resize', '160x120', '/tmp/a.webp']);
  const webp = await ok(['magick', 'identify', '-format', '%m %w %h', '/tmp/a.webp']);
  assert.equal(webp.trim(), 'WEBP 160 120', `logo: as webp: ${webp}`);
  await ok(['magick', '/tmp/a.webp', '-quality', '100', '-define', 'webp:lossless=true', '/tmp/b.webp']);
  const back = await ok(['magick', '/tmp/b.webp', '/tmp/b.png']);
  assert.equal(back, '');
  assert.equal((await ok(['magick', 'identify', '-format', '%m %w %h', '/tmp/b.png'])).trim(), 'PNG 160 120');

  const ink = async (args) =>
    Number((await ok(['magick', '-size', '200x60', 'xc:white', ...args, '-colorspace', 'gray', '-threshold', '50%', '-format', '%[fx:int((1-mean)*12000)]', 'info:'])).trim());
  const blank = await ink([]);
  const text = await ink(['-font', FONT, '-pointsize', '40', '-fill', 'black', '-annotate', '+10+45', 'Slicc']);
  assert.equal(blank, 0, `blank canvas has ink: ${blank}`);
  assert.ok(text > 300 && text < 6000, `freetype -annotate drew ${text} dark pixels of 12000`);

  await write('/tmp/r.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#ff0000"/><rect x="20" width="20" height="20" fill="#0000ff"/></svg>');
  const rgb = (x, y) => `%[fx:int(255*p{${x},${y}}.r)],%[fx:int(255*p{${x},${y}}.g)],%[fx:int(255*p{${x},${y}}.b)]`;
  const svg = await ok(['magick', 'msvg:/tmp/r.svg', '-format', `%w %h ${rgb(5, 5)} ${rgb(30, 10)}`, 'info:']);
  assert.equal(svg.trim(), '40 20 255,0,0 0,0,255', `SVG through the internal (libxml2) renderer: ${svg}`);

  await write('/tmp/m.msl', '<?xml version="1.0"?>\n<image>\n  <read filename="logo:"/>\n  <resize geometry="64x48"/>\n  <write filename="/tmp/m.png"/>\n</image>\n');
  await ok(['magick', 'msl:/tmp/m.msl', 'null:']);
  assert.equal((await ok(['magick', 'identify', '-format', '%m %w %h', '/tmp/m.png'])).trim(), 'PNG 64 48', 'MSL (libxml2) resize script');

  console.log(`checklist: delegates ${builtIn.join(' ')}; webp rw (160x120, lossless back to png); freetype annotate ${text} dark px; SVG red/blue; MSL resize 64x48`);
}
