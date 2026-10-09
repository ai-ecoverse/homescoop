/**
 * poppler checklist (homescoop#95): pdftotext (raw, layout, page ranges),
 * pdftoppm PNG at 72 and 150 dpi with the bundled base-14 fonts, pdfinfo,
 * an RC4-encrypted PDF, and the extra utils from the same multi-call wasm.
 * Test PDFs are generated here (makePdf below): Helvetica text, one line
 * per page, optionally encrypted with the Standard security handler R2.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts)).digest();
const padPw = (pw) => Buffer.concat([Buffer.from(pw, 'latin1'), PAD]).subarray(0, 32);
function rc4(key, data) {
  const s = [...Array(256).keys()];
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

// Tiny Helvetica PDF, one line of text per page, correct xref. With
// { user, owner }, the Standard security handler R2 (RC4, 40 bit).
function makePdf(texts, { user, owner } = {}) {
  const objs = [];
  const pageIds = texts.map((_, i) => 4 + i * 2);
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${texts.length} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  const streams = {};
  texts.forEach((t, i) => {
    objs[4 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    streams[5 + i * 2] = Buffer.from(`BT /F1 18 Tf 20 50 Td (${t}) Tj ET`, 'latin1');
  });
  const id = md5(Buffer.from(texts.join('|')));
  let key = null;
  let encId = null;
  if (user !== undefined) {
    const P = -44; // print + copy, nothing else
    const pBytes = Buffer.alloc(4);
    pBytes.writeInt32LE(P);
    const O = rc4(md5(padPw(owner ?? user)).subarray(0, 5), padPw(user));
    key = md5(padPw(user), O, pBytes, id).subarray(0, 5);
    const U = rc4(key, PAD);
    encId = 4 + texts.length * 2;
    objs[encId] = `<< /Filter /Standard /V 1 /R 2 /O <${O.toString('hex')}> /U <${U.toString('hex')}> /P ${P} >>`;
  }
  const chunks = [Buffer.from('%PDF-1.4\n')];
  let len = chunks[0].length;
  const offs = [];
  const last = encId ?? 3 + texts.length * 2;
  for (let o = 1; o <= last; o++) {
    offs[o] = len;
    let body;
    if (streams[o]) {
      let data = streams[o];
      if (key) {
        const ok = md5(key, Buffer.from([o & 255, (o >> 8) & 255, (o >> 16) & 255, 0, 0])).subarray(0, 10);
        data = rc4(ok, data);
      }
      body = Buffer.concat([
        Buffer.from(`${o} 0 obj\n<< /Length ${data.length} >>\nstream\n`, 'latin1'),
        data,
        Buffer.from('\nendstream\nendobj\n'),
      ]);
    } else {
      body = Buffer.from(`${o} 0 obj\n${objs[o]}\nendobj\n`, 'latin1');
    }
    chunks.push(body);
    len += body.length;
  }
  const size = offs.length;
  let tail = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let o = 1; o < size; o++) tail += `${String(offs[o]).padStart(10, '0')} 00000 n \n`;
  const hex = id.toString('hex');
  tail += `trailer\n<< /Size ${size} /Root 1 0 R /ID [<${hex}> <${hex}>]${encId ? ` /Encrypt ${encId} 0 R` : ''} >>\n`;
  tail += `startxref\n${len}\n%%EOF\n`;
  chunks.push(Buffer.from(tail, 'latin1'));
  return Buffer.concat(chunks);
}

const pngSize = (buf) => {
  assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG', 'not a PNG');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
};

export default async function (ctx) {
  const { run } = ctx;
  const cwd = '/home/pp';
  const go = (argv, env) => run(argv, { cwd, env });
  const ok = async (argv, env) => {
    const r = await go(argv, env);
    assert.equal(r.status, 0, `${argv.join(' ')}: rc=${r.status} stderr=${r.stderr}`);
    return r;
  };
  const bytes = async (f) => Buffer.from((await ok(['base64', '-w0', f])).stdout, 'base64');
  const put = async (f, buf) => {
    const w = await run(['bash', '-c', `base64 -d > ${f}`], { cwd, stdin: buf.toString('base64') });
    assert.equal(w.status, 0, `write ${f} stderr=${w.stderr}`);
  };

  const mk = await run(['mkdir', '-p', cwd], { cwd: '/home' });
  assert.equal(mk.status, 0, `mkdir stderr=${mk.stderr}`);
  await put('a.pdf', makePdf(['Alpha one', 'Alpha two', 'Alpha three']));
  await put('b.pdf', makePdf(['Bravo one', 'Bravo two']));
  await put('e.pdf', makePdf(['Secret one', 'Secret two'], { user: 'u', owner: 'o' }));

  const ver = await ok(['pdftoppm', '-v']);
  assert.match(ver.stderr, /^pdftoppm version 26\.10\.0$/m);

  // pdfinfo.
  const info = await ok(['pdfinfo', 'a.pdf']);
  assert.match(info.stdout, /^Pages: +3$/m);
  assert.match(info.stdout, /^Encrypted: +no$/m);
  assert.match(info.stdout, /^Page size: +200 x 100 pts$/m);
  assert.match(info.stdout, /^PDF version: +1\.4$/m);

  // pdftotext: default, raw, layout, page range, to a file.
  assert.equal((await ok(['pdftotext', 'a.pdf', '-'])).stdout, 'Alpha one\n\n\fAlpha two\n\n\fAlpha three\n\n\f');
  assert.equal((await ok(['pdftotext', '-raw', 'a.pdf', '-'])).stdout, 'Alpha one\fAlpha two\fAlpha three\f');
  assert.equal(
    (await ok(['pdftotext', '-layout', '-f', '2', '-l', '3', 'a.pdf', '-'])).stdout,
    'Alpha two\n\fAlpha three\n\f',
  );
  await ok(['pdftotext', '-f', '3', '-l', '3', 'a.pdf']);
  assert.equal((await ok(['cat', 'a.txt'])).stdout, 'Alpha three\n\n\f');

  // pdftoppm: page 1 at 72 and 150 dpi (200 x 100 pt, rounded up).
  await ok(['pdftoppm', '-png', '-r', '72', '-f', '1', '-l', '1', 'a.pdf', 'r72']);
  await ok(['pdftoppm', '-png', '-r', '150', '-f', '1', '-l', '1', 'a.pdf', 'r150']);
  const s72 = pngSize(await bytes('r72-1.png'));
  const s150 = pngSize(await bytes('r150-1.png'));
  assert.deepEqual(s72, [200, 100], `72 dpi ${s72}`);
  assert.deepEqual(s150, [417, 209], `150 dpi ${s150}`);

  // Page range: only pages 2 and 3, numbered by page.
  await ok(['mkdir', 'rng']);
  await ok(['pdftoppm', '-png', '-f', '2', '-l', '3', 'a.pdf', 'rng/p']);
  assert.equal((await ok(['ls', 'rng'])).stdout, 'p-2.png\np-3.png\n');
  assert.deepEqual(pngSize(await bytes('rng/p-3.png')), [417, 209], 'default is 150 dpi');

  // The glyphs come from the bundled fonts: dark pixels where the text is,
  // none elsewhere. Without the fonts, poppler says so and draws nothing.
  const gray = async (prefix, env) => {
    const r = await ok(['pdftoppm', '-gray', '-r', '72', '-f', '1', '-l', '1', 'a.pdf', prefix], env);
    const pgm = await bytes(`${prefix}-1.pgm`);
    const head = pgm.subarray(0, 15).toString('latin1');
    assert.equal(head, 'P5\n200 100\n255\n', `pgm header ${JSON.stringify(head)}`);
    const px = pgm.subarray(15);
    let dark = 0;
    let outside = 0;
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 200; x++) {
        if (px[y * 200 + x] < 128) {
          dark++;
          if (y < 30 || y > 56 || x < 18 || x > 110) outside++;
        }
      }
    }
    return { dark, outside, stderr: r.stderr };
  };
  const withFonts = await gray('g');
  assert.equal(withFonts.stderr, '', 'font warnings with the bundled fonts');
  assert.ok(withFonts.dark > 150, `only ${withFonts.dark} dark pixels`);
  assert.equal(withFonts.outside, 0, `${withFonts.outside} dark pixels outside the text`);
  const noFonts = await gray('nf', { POPPLER_FONTSDIR: '/nonexistent' });
  assert.match(noFonts.stderr, /No display font for 'Helvetica'/);
  assert.ok(noFonts.dark < withFonts.dark, 'missing fonts drew as much as the bundled ones');

  // Encrypted (RC4 40 bit): no or wrong password fails, user/owner work.
  const nopw = await go(['pdftotext', 'e.pdf', '-']);
  assert.equal(nopw.status, 1, `no password rc=${nopw.status}`);
  assert.match(nopw.stderr, /Incorrect password/);
  const badpw = await go(['pdfinfo', '-upw', 'nope', 'e.pdf']);
  assert.equal(badpw.status, 1, `wrong password rc=${badpw.status}`);
  assert.match(badpw.stderr, /Incorrect password/);
  assert.equal((await ok(['pdftotext', '-upw', 'u', 'e.pdf', '-'])).stdout, 'Secret one\n\n\fSecret two\n\n\f');
  assert.equal((await ok(['pdftotext', '-opw', 'o', '-raw', 'e.pdf', '-'])).stdout, 'Secret one\fSecret two\f');
  const einfo = await ok(['pdfinfo', '-upw', 'u', 'e.pdf']);
  assert.match(einfo.stdout, /^Encrypted: +yes \(print:yes copy:yes change:no addNotes:no algorithm:RC4\)$/m);
  await ok(['pdftoppm', '-png', '-r', '72', '-upw', 'u', '-f', '2', '-l', '2', 'e.pdf', 'enc']);
  assert.deepEqual(pngSize(await bytes('enc-2.png')), [200, 100]);

  // pdftocairo is pdftoppm (no cairo in this build).
  await ok(['pdftocairo', '-png', '-r', '72', '-f', '1', '-l', '1', 'a.pdf', 'c']);
  assert.deepEqual(pngSize(await bytes('c-1.png')), [200, 100]);

  // Extra utils from the same wasm.
  const fonts = await ok(['pdffonts', 'a.pdf']);
  assert.match(fonts.stdout, /^Helvetica +Type 1 +Standard +no +no +no +3 +0$/m);
  await ok(['pdfunite', 'a.pdf', 'b.pdf', 'u.pdf']);
  assert.match((await ok(['pdfinfo', 'u.pdf'])).stdout, /^Pages: +5$/m);
  assert.equal(
    (await ok(['pdftotext', '-raw', 'u.pdf', '-'])).stdout,
    'Alpha one\fAlpha two\fAlpha three\fBravo one\fBravo two\f',
  );
  await ok(['pdfseparate', '-f', '4', '-l', '5', 'u.pdf', 'sep-%d.pdf']);
  assert.equal((await ok(['pdftotext', '-raw', 'sep-5.pdf', '-'])).stdout, 'Bravo two\f');
  await ok(['pdftops', '-f', '1', '-l', '1', 'a.pdf', 'a.ps']);
  assert.match((await ok(['head', '-c', '11', 'a.ps'])).stdout, /^%!PS-Adobe/);

  // Errors.
  await ok(['bash', '-c', 'printf "garbage, not a pdf" > bad.pdf']);
  const bad = await go(['pdftotext', 'bad.pdf', '-']);
  assert.equal(bad.status, 1, `garbage rc=${bad.status}`);
  assert.match(bad.stderr, /Couldn't read xref table/);
  const badppm = await go(['pdftoppm', '-png', 'bad.pdf', 'bad']);
  assert.equal(badppm.status, 1, `pdftoppm garbage rc=${badppm.status}`);
  const miss = await go(['pdfinfo', 'missing.pdf']);
  assert.equal(miss.status, 1, `missing rc=${miss.status}`);
  assert.match(miss.stderr, /Couldn't open file 'missing\.pdf'/);
  const unite = await go(['pdfunite', 'a.pdf', 'e.pdf', 'x.pdf']);
  assert.notEqual(unite.status, 0, 'pdfunite with an encrypted input should fail');
  assert.match(unite.stderr, /Could not merge damaged documents/);
  assert.doesNotMatch(unite.stderr, /usage: poppler-multicall/);
}
