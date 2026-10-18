import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';

function pdf(objects, { xrefStream = false, version = '1.4' } = {}) {
  const chunks = [Buffer.from(`%PDF-${version}\n%\xe2\xe3\xcf\xd3\n`, 'latin1')];
  let len = chunks[0].length;
  const offs = [];
  const n = objects.length;
  for (let i = 0; i < n; i++) {
    offs[i + 1] = len;
    const o = objects[i];
    const body = o.stream
      ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< ${o.dict} /Length ${o.stream.length} >>\nstream\n`, 'latin1'), o.stream, Buffer.from('\nendstream\nendobj\n')])
      : Buffer.from(`${i + 1} 0 obj\n${o.dict}\nendobj\n`, 'latin1');
    chunks.push(body);
    len += body.length;
  }
  if (xrefStream) {
    const id = n + 1;
    offs[id] = len;
    const rows = [];
    for (let i = 0; i <= id; i++) {
      const row = Buffer.alloc(7);
      if (i === 0) row.writeUInt8(0, 0);
      else {
        row.writeUInt8(1, 0);
        row.writeUInt32BE(offs[i], 1);
      }
      if (i === 0) row.writeUInt16BE(65535, 5);
      rows.push(row);
    }
    const data = deflateSync(Buffer.concat(rows));
    chunks.push(Buffer.from(`${id} 0 obj\n<< /Type /XRef /Size ${id + 1} /W [1 4 2] /Root 1 0 R /Filter /FlateDecode /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from(`\nendstream\nendobj\nstartxref\n${len}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(chunks);
  }
  let tail = `xref\n0 ${n + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= n; i++) tail += `${String(offs[i]).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<< /Size ${n + 1} /Root 1 0 R >>\nstartxref\n${len}\n%%EOF\n`;
  chunks.push(Buffer.from(tail, 'latin1'));
  return Buffer.concat(chunks);
}

const page = (contents, resources = '') => [
  { dict: '<< /Type /Catalog /Pages 2 0 R >>' },
  { dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
  { dict: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << ${resources} >> /Contents 4 0 R >>` },
  { dict: '/Filter /FlateDecode', stream: deflateSync(Buffer.from(contents, 'latin1')) },
];

function pngPixels(buf) {
  assert.equal(buf.toString('latin1', 1, 4), 'PNG', 'a PNG');
  let p = 8;
  let w;
  let h;
  let type;
  const idat = [];
  while (p < buf.length) {
    const n = buf.readUInt32BE(p);
    const t = buf.toString('latin1', p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + n);
    if (t === 'IHDR') [w, h, type] = [d.readUInt32BE(0), d.readUInt32BE(4), d[9]];
    if (t === 'IDAT') idat.push(d);
    p += 12 + n;
  }
  const bpp = type === 2 ? 3 : type === 6 ? 4 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= bpp ? out[y * stride + i - bpp] : 0;
      const b = y ? out[(y - 1) * stride + i] : 0;
      const c = i >= bpp && y ? out[(y - 1) * stride + i - bpp] : 0;
      const pp = a + b - c;
      const pa = Math.abs(pp - a);
      const pb = Math.abs(pp - b);
      const pc = Math.abs(pp - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      out[y * stride + i] = (x + [0, a, b, (a + b) >> 1, paeth][f]) & 255;
    }
  }
  return { w, h, bpp, at: (x, y) => [...out.subarray((y * w + x) * bpp, (y * w + x) * bpp + 3)] };
}

function jpegSof(buf) {
  assert.deepEqual([buf[0], buf[1]], [0xff, 0xd8], 'a JPEG');
  for (let p = 2; p < buf.length; ) {
    if (buf[p] !== 0xff) return null;
    const m = buf[p + 1];
    const n = buf.readUInt16BE(p + 2);
    if (m === 0xc0 || m === 0xc2) return { progressive: m === 0xc2, h: buf.readUInt16BE(p + 5), w: buf.readUInt16BE(p + 7) };
    p += 2 + n;
  }
  return null;
}

function iccProfile() {
  const s15 = (v) => {
    const b = Buffer.alloc(4);
    b.writeInt32BE(Math.round(v * 65536));
    return b;
  };
  const xyz = (x, y, z) => Buffer.concat([Buffer.from('XYZ \0\0\0\0', 'latin1'), s15(x), s15(y), s15(z)]);
  const curv = Buffer.from('curv\0\0\0\0\0\0\0\0', 'latin1');
  const text = Buffer.from('desc\0\0\0\0\0\0\0\x06homes\0' + '\0'.repeat(4 + 4 + 2 + 1 + 67), 'latin1');
  const tags = [['desc', text], ['wtpt', xyz(0.9642, 1, 0.8249)], ['rXYZ', xyz(0.4361, 0.2225, 0.0139)], ['gXYZ', xyz(0.3851, 0.7169, 0.0971)], ['bXYZ', xyz(0.1431, 0.0606, 0.7141)], ['rTRC', curv], ['gTRC', curv], ['bTRC', curv]];
  let off = 128 + 4 + tags.length * 12;
  const table = [];
  const data = [];
  for (const [sig, d] of tags) {
    const pad = Buffer.alloc((4 - (d.length % 4)) % 4);
    const e = Buffer.alloc(12);
    e.write(sig, 0, 'latin1');
    e.writeUInt32BE(off, 4);
    e.writeUInt32BE(d.length, 8);
    table.push(e);
    data.push(d, pad);
    off += d.length + pad.length;
  }
  const count = Buffer.alloc(4);
  count.writeUInt32BE(tags.length);
  const header = Buffer.alloc(128);
  header.writeUInt32BE(off, 0);
  header.writeUInt32BE(0x02100000, 8);
  header.write('mntrRGB XYZ ', 12, 'latin1');
  header.write('acsp', 36, 'latin1');
  s15(0.9642).copy(header, 68);
  s15(1).copy(header, 72);
  s15(0.8249).copy(header, 76);
  return Buffer.concat([header, count, ...table, ...data]);
}

export default async function inputs(ctx) {
  const { run } = ctx;
  const cwd = '/home/ppin';
  const go = (argv) => run(argv, { cwd });
  const ok = async (argv) => {
    const r = await go(argv);
    assert.equal(r.status, 0, `${argv.join(' ')}: rc=${r.status} stderr=${r.stderr}`);
    return r;
  };
  const bytes = async (f) => Buffer.from((await ok(['base64', '-w0', f])).stdout, 'base64');
  const put = async (f, buf) => {
    const w = await run(['bash', '-c', `base64 -d > ${f}`], { cwd, stdin: buf.toString('base64') });
    assert.equal(w.status, 0, `write ${f}: ${w.stderr}`);
  };
  assert.equal((await run(['mkdir', '-p', cwd], { cwd: '/home' })).status, 0);
  const near = (got, want, tol, what) => assert.ok(got.every((v, i) => Math.abs(v - want[i]) <= tol), `${what}: ${got} vs ${want} (±${tol})`);

  const rects = '1 0 0 rg 10 10 80 80 re f 0 0 1 rg 110 10 80 80 re f';
  await put('flate.pdf', pdf(page(rects), { xrefStream: true, version: '1.5' }));
  assert.match((await ok(['pdfinfo', 'flate.pdf'])).stdout, /^PDF version: +1\.5$/m, 'a PDF 1.5 file with a compressed xref stream');
  await ok(['pdftoppm', '-png', '-r', '72', 'flate.pdf', 'flate']);
  const png = pngPixels(await bytes('flate-1.png'));
  assert.deepEqual([png.w, png.h], [200, 100]);
  assert.deepEqual(png.at(50, 50), [255, 0, 0], 'zlib (Flate content, xref stream) and libpng: the red rect is exactly red');
  assert.deepEqual(png.at(150, 50), [0, 0, 255], 'and the blue one exactly blue');
  assert.deepEqual(png.at(100, 5), [255, 255, 255], 'and the gap is white');

  await ok(['pdftoppm', '-jpeg', '-r', '72', 'flate.pdf', 'base']);
  const base = await bytes('base-1.jpg');
  assert.deepEqual(jpegSof(base), { progressive: false, h: 100, w: 200 }, 'libjpeg-turbo: pdftoppm -jpeg writes a 200x100 baseline JPEG');
  await ok(['pdftoppm', '-jpeg', '-jpegopt', 'quality=40,progressive=y', '-r', '72', 'flate.pdf', 'prog']);
  const prog = await bytes('prog-1.jpg');
  assert.equal(jpegSof(prog).progressive, true, '-jpegopt progressive=y is SOF2');
  assert.ok(prog.length < base.length, `quality=40 (${prog.length}) is smaller than the default (${base.length})`);

  await put('dct.pdf', pdf([...page('q 200 0 0 100 0 0 cm /Im1 Do Q', '/XObject << /Im1 5 0 R >>'), { dict: '/Type /XObject /Subtype /Image /Width 200 /Height 100 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', stream: base }]));
  assert.match((await ok(['pdfimages', '-list', 'dct.pdf'])).stdout, /\bjpeg\b/, 'pdfimages -list sees a DCTDecode image');
  await ok(['pdfimages', '-j', 'dct.pdf', 'img']);
  assert.deepEqual(await bytes('img-000.jpg'), base, 'pdfimages -j returns the embedded JPEG byte for byte');
  await ok(['pdftoppm', '-png', '-r', '72', 'dct.pdf', 'dct']);
  const dct = pngPixels(await bytes('dct-1.png'));
  near(dct.at(50, 50), [255, 0, 0], 24, 'the DCT image renders red');
  near(dct.at(150, 50), [0, 0, 255], 24, 'and blue');

  const icc = iccProfile();
  const pixels = Buffer.from([255, 0, 0, 128, 128, 128, 0, 255, 0]);
  await put('icc.pdf', pdf([
    ...page('q 200 0 0 100 0 0 cm /Im1 Do Q', '/XObject << /Im1 5 0 R >>'),
    { dict: '/Type /XObject /Subtype /Image /Width 3 /Height 1 /ColorSpace [/ICCBased 6 0 R] /BitsPerComponent 8 /Filter /FlateDecode', stream: deflateSync(pixels) },
    { dict: '/N 3 /Filter /FlateDecode', stream: deflateSync(icc) },
  ]));
  assert.match((await ok(['pdfimages', '-list', 'icc.pdf'])).stdout, /\bicc\b/, 'pdfimages -list shows the ICCBased colour space');
  const ir = await ok(['pdftoppm', '-png', '-r', '72', 'icc.pdf', 'icc']);
  assert.doesNotMatch(ir.stderr, /error/i, `lcms2: the profile loads: ${ir.stderr}`);
  const ip = pngPixels(await bytes('icc-1.png'));
  near(ip.at(33, 50), [255, 0, 0], 40, 'ICC red');
  near(ip.at(100, 50), [188, 188, 188], 24, 'ICC gray: linear 0.5 through the profile\'s gamma-1 curves is sRGB 188');
  near(ip.at(166, 50), [0, 255, 0], 40, 'ICC green');

  const pages = 40;
  const objs = [{ dict: '<< /Type /Catalog /Pages 2 0 R >>' }, { dict: `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${4 + 2 * i} 0 R`).join(' ')}] /Count ${pages} >>` }, { dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' }];
  for (let i = 0; i < pages; i++) {
    objs.push({ dict: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>` });
    objs.push({ dict: '/Filter /FlateDecode', stream: deflateSync(Buffer.from(`BT /F1 18 Tf 20 50 Td (Page ${i + 1}) Tj ET`, 'latin1')) });
  }
  await put('many.pdf', pdf(objs));
  const txt = (await ok(['pdftotext', '-raw', 'many.pdf', '-'])).stdout;
  assert.equal(txt.split('\f').filter(Boolean).length, pages, '40 Flate pages of text');
  assert.ok(txt.includes('Page 40'), 'the last page is there');
  await ok(['pdftoppm', '-gray', '-r', '18', 'many.pdf', 'g']);
  const listed = (await ok(['bash', '-c', 'ls g-*.pgm | wc -l'])).stdout.trim();
  assert.equal(listed, String(pages), 'pdftoppm -gray writes one PGM per page');

  const good = pdf(page(rects));
  const s = good.indexOf('stream\n') + 7;
  const cut = Buffer.concat([good.subarray(0, s + 6), good.subarray(s + 6 + 10)]);
  await put('cut.pdf', cut);
  const c = await go(['pdftotext', 'cut.pdf', '-']);
  assert.ok(c.status === 0 || c.status === 1, `a damaged Flate stream: rc ${c.status}`);
  assert.doesNotMatch(c.stderr, /RuntimeError|unreachable|Aborted/, c.stderr);
}
