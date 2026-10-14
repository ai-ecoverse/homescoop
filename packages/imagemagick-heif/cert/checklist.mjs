import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOLERANCE } from '../../libheif/cert/lib/cases.mjs';
import { fixture } from '../../libheif/cert/lib/fixtures.mjs';
import { exifOrientation, jpegSize } from '../../libheif/cert/lib/jpeg.mjs';
import { pagePngDigest, pagePut, pageReadB64 } from '../../libheif/cert/lib/page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REF = JSON.parse(readFileSync(join(here, '../../libheif/cert/fixtures/references.json'), 'utf8'));
const DIR = 'home/im';
const CWD = `/${DIR}`;
const FATAL = /RuntimeError|Aborted|unreachable|memory access out of bounds|wasm trap/i;
const INPUTS = ['iphone_13_pro_max.heic', 'pug.heic', 'example.heic', 'example.avif', 'rainbow-451x461.heic', 'rot90-17x9.heic', '1x1.heic'];

export default async function imagemagickHeif(ctx) {
  const { assert, page } = ctx;
  const put = (name, buf) => page.evaluate(pagePut, `${DIR}/${name}`, Buffer.from(buf).toString('base64'));
  const readB64 = async (name) => {
    const b = await page.evaluate(pageReadB64, `${DIR}/${name}`);
    return b === null ? null : Buffer.from(b, 'base64');
  };
  const digest = (name, fixes, probes) => page.evaluate(pagePngDigest, `${DIR}/${name}`, fixes, probes);
  const run = (argv) => ctx.run(argv, { cwd: CWD });
  const ok = async (argv) => {
    const r = await run(argv);
    assert.equal(r.status, 0, `${argv.join(' ')}: rc ${r.status}\n${r.stderr}`);
    assert.doesNotMatch(r.stderr, FATAL, argv.join(' '));
    return r;
  };
  const sameAsHost = async (out, ref) => {
    const want = REF.png[ref];
    const got = await digest(out, want.fixes, []);
    assert.ok(got, `${out} written`);
    assert.deepEqual([got.width, got.height, got.depth, got.colorType], [want.width, want.height, want.depth, want.colorType], `${out} shape`);
    assert.ok(got.worst <= TOLERANCE.maxDelta[want.depth], `${out}: listed sample off by ${got.worst}`);
    assert.equal(got.sha256, want.sha256, `${out}: pixels differ from host libheif 1.23.6 (${ref})`);
  };

  for (const name of INPUTS) await put(name, await fixture(name));

  {
    const v = await ok(['magick', '-version']);
    assert.match(v.stdout, /^Version: ImageMagick 7\.1\.2-32 /);
    assert.match(v.stdout, /Delegates \(built-in\):.*\bheic\b/);
    for (const d of ['freetype', 'webp', 'xml']) assert.match(v.stdout, new RegExp(`Delegates \\(built-in\\):.*\\b${d}\\b`), `default delegate ${d} kept`);
    const f = await ok(['magick', '-list', 'format']);
    assert.match(f.stdout, /^\s+HEIC\*?\s+r--\s+High Efficiency Image Format \(1\.23\.6\)$/m);
    assert.match(f.stdout, /^\s+AVIF\*?\s+r--\s+AV1 Image File Format \(1\.23\.6\)$/m);
  }

  {
    const i = await ok(['identify', 'iphone_13_pro_max.heic']);
    assert.match(i.stdout, /^iphone_13_pro_max\.heic HEIC 3024x4032 3024x4032\+0\+0 8-bit sRGB /);
    const f = await ok(['identify', '-format', '%m %w %h %[orientation] %[EXIF:Make] %[EXIF:Model]\n', 'iphone_13_pro_max.heic']);
    assert.equal(f.stdout, 'HEIC 3024 4032 TopLeft Apple iPhone 13 Pro Max\n');
    const p = await ok(['identify', '-define', 'heic:preserve-orientation=true', '-format', '%w %h %[orientation]\n', 'iphone_13_pro_max.heic']);
    assert.equal(p.stdout, '4032 3024 RightTop\n');
    const m = await ok(['identify', 'example.heic']);
    assert.match(m.stdout, /^example\.heic\[0\] HEIC 1280x854 1280x854\+0\+0 8-bit sRGB .*\nexample\.heic\[1\] HEIC 1280x854 1280x854\+0\+0 8-bit sRGB /);
    const a = await ok(['identify', '-format', '%m %w %h\n', 'example.avif']);
    assert.equal(a.stdout, 'AVIF 800 533\n');
    const d = await ok(['identify', '-define', 'heic:depth-image=true', '-format', '%w %h\n', 'pug.heic']);
    assert.equal(d.stdout, '4032 3024\n768 576\n');
  }

  await ok(['magick', 'iphone_13_pro_max.heic', 'PNG24:iphone13.png']);
  await sameAsHost('iphone13.png', 'iphone13.png');
  await ok(['magick', 'pug.heic', 'PNG24:pug.png']);
  await sameAsHost('pug.png', 'pug.png');
  await ok(['magick', 'example.heic', 'PNG24:example-%d.png']);
  await sameAsHost('example-0.png', 'example-1.png');
  await sameAsHost('example-1.png', 'example-2.png');
  await ok(['magick', 'example.avif', 'PNG24:avif.png']);
  await sameAsHost('avif.png', 'avif.png');
  await ok(['magick', 'rainbow-451x461.heic', 'PNG24:rainbow.png']);
  await sameAsHost('rainbow.png', 'rainbow.png');
  await ok(['magick', '1x1.heic', 'PNG24:one.png']);
  await sameAsHost('one.png', 'one.png');
  await ok(['magick', 'rot90-17x9.heic', 'PNG24:rot90.png']);
  await sameAsHost('rot90.png', 'rot90.png');

  {
    await ok(['magick', 'iphone_13_pro_max.heic', '-resize', '25%', '-quality', '85', 'small.jpg']);
    const small = await readB64('small.jpg');
    assert.deepEqual(jpegSize(small), { width: 756, height: 1008 });
    const o = exifOrientation(small);
    assert.ok(o === null || o === 1, `resized JPEG EXIF Orientation ${o}`);
    await ok(['magick', 'iphone_13_pro_max.heic', '-resize', '640x640', 'PNG24:fit.png']);
    const fit = await digest('fit.png', [], []);
    assert.deepEqual([fit.width, fit.height], [480, 640]);
    await ok(['convert', 'example.heic[1]', '-resize', '50%', 'PNG24:half.png']);
    const half = await digest('half.png', [], []);
    assert.deepEqual([half.width, half.height], [640, 427]);
    await ok(['mogrify', '-format', 'jpg', 'rainbow-451x461.heic']);
    assert.deepEqual(jpegSize(await readB64('rainbow-451x461.jpg')), { width: 451, height: 461 });
    await ok(['magick', 'rainbow-451x461.heic', '-quality', '80', 'rainbow.webp']);
    const webp = await readB64('rainbow.webp');
    assert.equal(webp.subarray(0, 4).toString('latin1') + webp.subarray(8, 12).toString('latin1'), 'RIFFWEBP', 'HEIC to WebP');
    await ok(['magick', '-define', 'heic:preserve-orientation=true', 'iphone_13_pro_max.heic', '-auto-orient', '-resize', '10%', 'PNG24:auto.png']);
    const auto = await digest('auto.png', [], []);
    assert.deepEqual([auto.width, auto.height], [302, 403], 'preserve-orientation + -auto-orient gives the upright image');
  }

  {
    const u = await ok(['bash', '-c', 'umask 027 && magick rot90-17x9.heic PNG24:umask.png && stat -c %a umask.png']);
    assert.equal(u.stdout, '640\n', 'files magick creates honour the umask');
  }

  {
    const rainbow = await fixture('rainbow-451x461.heic');
    await put('trunc.heic', rainbow.subarray(0, 3000));
    await put('empty.heic', Buffer.alloc(0));
    for (const f of ['trunc.heic', 'empty.heic', 'missing.heic']) {
      const r = await run(['magick', f, `${f}.png`]);
      assert.equal(r.status, 1, `magick ${f}: rc ${r.status}\n${r.stderr}`);
      assert.match(r.stderr, /magick: /, f);
      assert.doesNotMatch(r.stderr, FATAL, f);
      assert.equal(await readB64(`${f}.png`), null, `${f}: no output`);
    }
    const enc = await run(['magick', 'rainbow.png', 'out.heic']);
    assert.match(enc.stderr, /no encode delegate for this image format `HEIC'/, 'no HEVC encoder');
    assert.doesNotMatch(enc.stderr, FATAL);
    const written = await readB64('out.heic');
    assert.ok(!written || written.subarray(4, 8).toString('latin1') !== 'ftyp', 'out.heic is not HEIF');
    const after = await ok(['identify', '-format', '%w\n', 'rot90-17x9.heic']);
    assert.equal(after.stdout, '9\n');
  }
}
