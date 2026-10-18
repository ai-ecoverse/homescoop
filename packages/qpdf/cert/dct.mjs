const W = 64;
const H = 64;
const px = () => [80, 40, 128];

function imagePdf() {
  const hex = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) hex.push(...px(x, y).map((v) => v.toString(16).padStart(2, '0')));
  const data = `${hex.join('')}>`;
  const content = `q ${W} 0 0 ${H} 0 0 cm /Im1 Do Q`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${data.length} >>\nstream\n${data}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => {
    offs[i + 1] = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) out += `${String(offs[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

export default async function dct(ctx) {
  const { run, assert } = ctx;
  const cwd = '/home/qpdct';
  const go = (argv) => run(argv, { cwd });
  const ok = async (argv) => {
    const r = await go(argv);
    assert.equal(r.status, 0, `${argv.join(' ')}: rc=${r.status} stderr=${r.stderr}`);
    return r;
  };
  assert.equal((await run(['mkdir', '-p', cwd], { cwd: '/home' })).status, 0);
  const w = await run(['bash', '-c', 'cat > img.pdf'], { cwd, stdin: imagePdf() });
  assert.equal(w.status, 0, w.stderr);
  await ok(['qpdf', '--optimize-images', '--oi-min-width=0', '--oi-min-height=0', '--oi-min-area=0', '--object-streams=disable', 'img.pdf', 'opt.pdf']);
  await ok(['qpdf', '--qdf', '--decode-level=generalized', 'opt.pdf', 'qdf.pdf']);
  const qdf = await ok(['cat', 'qdf.pdf']);
  assert.match(qdf.stdout, /\/Filter \/DCTDecode/, 'libjpeg-turbo: --optimize-images re-encodes the image as /DCTDecode');
  assert.doesNotMatch(qdf.stdout, /ASCIIHexDecode/);
  const check = await ok(['qpdf', '--check', 'opt.pdf']);
  assert.match(check.stdout, /No syntax or stream encoding errors found/);
  const obj = qdf.stdout.split('endobj').map((o) => o.match(/(\d+) 0 obj\n<<[^]*\/Subtype \/Image/)).find(Boolean)?.[1];
  assert.ok(obj, 'the image object in the QDF output');
  const raw = await ok(['bash', '-c', `qpdf --show-object=${obj} --filtered-stream-data --decode-level=all qdf.pdf | base64 -w0`]);
  const pixels = Buffer.from(raw.stdout, 'base64');
  assert.equal(pixels.length, W * H * 3, `libjpeg-turbo: --decode-level=all decodes the DCT stream (object ${obj}) to w*h*3 bytes`);
  for (const [x, y] of [[0, 0], [31, 31], [63, 0], [10, 50]]) {
    const got = [...pixels.subarray((y * W + x) * 3, (y * W + x) * 3 + 3)];
    const want = px(x, y);
    assert.ok(got.every((v, i) => Math.abs(v - want[i]) <= 12), `pixel ${x},${y}: ${got} vs ${want}`);
  }
}
