import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, inflateSync } from 'node:zlib';

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

export default async function ({ assert, dir, stdout, version }) {
  assert.match(stdout, new RegExp(`^libpng ${version.replaceAll('.', '\\.')}$`, 'm'), 'png_get_libpng_ver is the recipe version');
  const png = readFileSync(join(dir, 'probe.png'));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
  let p = 8;
  const chunks = [];
  while (p < png.length) {
    const len = png.readUInt32BE(p);
    const type = png.toString('latin1', p + 4, p + 8);
    const data = png.subarray(p + 8, p + 8 + len);
    assert.equal(png.readUInt32BE(p + 8 + len), crc32(png.subarray(p + 4, p + 8 + len)), `${type} CRC`);
    chunks.push({ type, data });
    p += 12 + len;
  }
  assert.equal(chunks[0].type, 'IHDR');
  assert.equal(chunks.at(-1).type, 'IEND');
  const ihdr = chunks[0].data;
  const [w, h] = [ihdr.readUInt32BE(0), ihdr.readUInt32BE(4)];
  assert.deepEqual([w, h, ihdr[8], ihdr[9]], [64, 48, 8, 6], 'IHDR 64x48, 8-bit RGBA');
  const ztxt = chunks.find((c) => c.type === 'zTXt');
  assert.ok(ztxt, 'a zTXt chunk');
  const z = ztxt.data.indexOf(0);
  assert.equal(ztxt.data.toString('latin1', 0, z), 'Comment');
  assert.equal(inflateSync(ztxt.data.subarray(z + 2)).toString('latin1'), 'homescoop libpng probe', "Node's zlib inflates the zTXt text");
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = w * 4;
  assert.equal(raw.length, (stride + 1) * h, 'IDAT inflates to one filter byte plus a row per scanline');
  const out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= 4 ? out[y * stride + i - 4] : 0;
      const b = y ? out[(y - 1) * stride + i] : 0;
      const c = i >= 4 && y ? out[(y - 1) * stride + i - 4] : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f];
      assert.ok(pred !== undefined, `filter type ${f}`);
      out[y * stride + i] = (x + pred) & 255;
    }
  }
  const want = [(x) => x * 4, (x, y) => y * 5, (x, y) => (x ^ y) * 3, (x, y) => 255 - x - y];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) assert.equal(out[y * stride + x * 4 + c], want[c](x, y) & 255, `pixel ${x},${y}.${c}`);
}
