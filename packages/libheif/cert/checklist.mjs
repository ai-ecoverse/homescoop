import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INFO_CASES, PNG_CASES, TOLERANCE } from './lib/cases.mjs';
import { FIXTURES, fixture } from './lib/fixtures.mjs';
import { exifOrientation, jpegSize } from './lib/jpeg.mjs';
import { pagePngDigest, pagePut, pageReadB64 } from './lib/page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REF = JSON.parse(readFileSync(join(here, 'fixtures', 'references.json'), 'utf8'));
const DIR = 'home/heif';
const CWD = `/${DIR}`;
const FATAL = /RuntimeError|Aborted|unreachable|memory access out of bounds|wasm trap/i;

export default async function libheif(ctx) {
  const { assert, page } = ctx;
  const put = (name, buf) => page.evaluate(pagePut, `${DIR}/${name}`, Buffer.from(buf).toString('base64'));
  const readB64 = async (name) => {
    const b = await page.evaluate(pageReadB64, `${DIR}/${name}`);
    return b === null ? null : Buffer.from(b, 'base64');
  };
  const digest = (name, fixes, probes) => page.evaluate(pagePngDigest, `${DIR}/${name}`, fixes, probes);
  const run = (argv) => ctx.run(argv, { cwd: CWD });

  for (const name of Object.keys(FIXTURES)) await put(name, await fixture(name));

  {
    const v = await run(['heif-convert', '--version']);
    assert.equal(v.status, 0, v.stderr);
    assert.match(v.stdout, /^1\.23\.6\nlibheif: 1\.23\.6\nplugin path: plugins are disabled\n/);
    const i = await run(['heif-info', '--version']);
    assert.equal(i.status, 0, i.stderr);
    assert.match(i.stdout, /^1\.23\.6\n/);
    const d = await run(['heif-convert', '--list-decoders']);
    assert.equal(d.status, 0, d.stderr);
    assert.match(d.stdout, /HEIC decoders:\n- libde265 = libde265 HEVC decoder, version 1\.1\.3\n/);
    assert.match(d.stdout, /AVIF decoders:\n- dav1d = dav1d /);
    const dec = await run(['heif-dec', '--version']);
    assert.equal(dec.status, 0, dec.stderr);
  }

  for (const f of INFO_CASES) {
    const r = await run(['heif-info', f]);
    assert.equal(r.status, 0, `heif-info ${f}: ${r.stderr}`);
    assert.equal(r.stdout, REF.info[f], `heif-info ${f} differs from host libheif 1.23.6`);
  }

  for (const c of PNG_CASES) {
    const r = await run(['heif-convert', '--quiet', ...c.args]);
    assert.equal(r.status, 0, `heif-convert ${c.args.join(' ')}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, FATAL);
    for (const o of c.outputs) {
      const ref = REF.png[o];
      assert.ok(ref, `no reference for ${o}`);
      const got = await digest(o, ref.fixes, []);
      assert.ok(got, `${c.id}: ${o} not written`);
      assert.deepEqual(
        { width: got.width, height: got.height, colorType: got.colorType, depth: got.depth },
        { width: ref.width, height: ref.height, colorType: ref.colorType, depth: ref.depth },
        `${o} shape`,
      );
      assert.ok(got.worst <= TOLERANCE.maxDelta[ref.depth], `${o}: a listed sample differs by ${got.worst}`);
      assert.ok(ref.fixes.length <= TOLERANCE.maxFixedFraction * got.samples, `${o}: ${ref.fixes.length} samples outside exact match`);
      assert.equal(got.sha256, ref.sha256, `${o}: pixels differ from host libheif 1.23.6 beyond the ${ref.fixes.length} listed samples`);
    }
  }

  {
    const got = await digest('rot90.png', [], [[0, 0], [4, 0], [5, 0], [8, 0], [8, 7], [8, 8], [0, 16]]);
    assert.deepEqual([got.width, got.height], [9, 17], 'irot applied: 17x9 shows as 9x17');
    const isRed = (p) => p[0] > 200 && p[1] < 50 && p[2] < 50;
    const isBlue = (p) => p[0] < 50 && p[1] < 50 && p[2] > 200;
    assert.deepEqual(got.probes.map((p) => (isRed(p) ? 'r' : isBlue(p) ? 'b' : '?')), ['b', 'b', 'r', 'r', 'r', 'b', 'b']);
    assert.deepEqual([REF.png['iphone13.png'].width, REF.png['iphone13.png'].height], [3024, 4032]);
  }

  {
    const r = await run(['heif-convert', '--quiet', '--with-exif', '-q', '92', 'iphone_13_pro_max.heic', 'iphone13.jpg']);
    assert.equal(r.status, 0, r.stderr);
    const jpg = await readB64('iphone13.jpg');
    const exif = await readB64('iphone13.exif');
    assert.ok(jpg && exif, 'iphone13.jpg and iphone13.exif written');
    assert.deepEqual(jpegSize(jpg), { width: 3024, height: 4032 }, 'JPEG is upright (rotated by irot)');
    assert.equal(exifOrientation(jpg), 1, 'embedded EXIF Orientation reset to 1 because the rotation is applied');
    assert.equal(exifOrientation(exif), 6, '--with-exif keeps the original EXIF (Orientation 6)');
    assert.ok(exif.includes(Buffer.from('iPhone 13 Pro Max')), 'EXIF names the camera');
    const lo = await run(['heif-convert', '--quiet', '-q', '30', 'iphone_13_pro_max.heic', 'iphone13-q30.jpg']);
    assert.equal(lo.status, 0, lo.stderr);
    const small = await readB64('iphone13-q30.jpg');
    assert.ok(small.length < jpg.length, '-q 30 is smaller than -q 92');
    assert.equal(exifOrientation(small), 1);
  }

  {
    const r = await run(['heif-convert', '--quiet', 'example.heic', 'example.jpg']);
    assert.equal(r.status, 0, r.stderr);
    for (const n of ['example-1.jpg', 'example-2.jpg']) {
      const b = await readB64(n);
      assert.ok(b, `${n} written`);
      assert.deepEqual(jpegSize(b), { width: 1280, height: 854 }, n);
    }
    const v = await run(['heif-convert', 'pug.heic', 'pug-v.jpg']);
    assert.equal(v.status, 0, v.stderr);
    assert.match(v.stdout + v.stderr, /File contains 1 image/);
    const a = await run(['heif-convert', '--quiet', '--with-aux', '--no-colons', 'pug.heic', 'pug-a.jpg']);
    assert.equal(a.status, 0, a.stderr);
    assert.deepEqual(jpegSize(await readB64('pug-a.jpg')), { width: 4032, height: 3024 });
    assert.deepEqual(jpegSize(await readB64('pug-a-depth.jpg')), { width: 768, height: 576 });
    assert.deepEqual(jpegSize(await readB64('pug-a-urn_com_apple_photo_2020_aux_hdrgainmap.jpg')), { width: 2016, height: 1512 });
  }

  {
    const rainbow = await fixture('rainbow-451x461.heic');
    await put('trunc.heic', rainbow.subarray(0, 3000));
    await put('garbage.heic', Buffer.concat([Buffer.from('00000018667479706865696300000000', 'hex'), Buffer.from('mif1heicgarbagegarbage')]));
    await put('empty.heic', Buffer.alloc(0));
    const cases = [
      ['trunc.heic', 1, /Could not read HEIF\/AVIF file: Invalid input: Unexpected end of file/],
      ['garbage.heic', 1, /Could not read HEIF\/AVIF file: Invalid input/],
      ['empty.heic', 1, /Input file does not appear to start with a valid box length|File size too small/],
      ['missing.heic', 10, /Input file does not exist\./],
    ];
    for (const [f, rc, re] of cases) {
      const r = await run(['heif-convert', f, `${f}.png`]);
      assert.equal(r.status, rc, `heif-convert ${f}: rc ${r.status} ${r.stderr}`);
      assert.match(r.stdout + r.stderr, re, f);
      assert.doesNotMatch(r.stdout + r.stderr, FATAL, f);
      assert.equal(await readB64(`${f}.png`), null, `${f}: no output written`);
      const i = await run(['heif-info', f]);
      assert.equal(i.status, rc, `heif-info ${f}: rc ${i.status}`);
      assert.doesNotMatch(i.stdout + i.stderr, FATAL, f);
    }
    const bad = await run(['heif-convert', '--quiet', 'badmdat.heic', 'badmdat.png']);
    assert.doesNotMatch(bad.stdout + bad.stderr, FATAL, 'damaged HEVC data does not trap');
    assert.ok(bad.status === 0 || bad.status === 1, `badmdat rc ${bad.status}`);
    if (bad.status === 0) {
      const got = await digest('badmdat.png', [], []);
      assert.deepEqual([got.width, got.height], [451, 461]);
    }
    const after = await run(['heif-info', 'rot90-17x9.heic']);
    assert.equal(after.status, 0, 'still works after the error cases');
  }
}
