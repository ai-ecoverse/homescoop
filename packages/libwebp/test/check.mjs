import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function ({ assert, dir, stdout, version }) {
  const v = version.replaceAll('.', '\\.');
  assert.match(stdout, new RegExp(`^libwebp encoder ${v} decoder ${v}$`, 'm'), 'WebPGetEncoderVersion and WebPGetDecoderVersion are the recipe version');
  for (const name of ['lossless', 'lossy', 'sharp-yuv']) assert.match(stdout, new RegExp(`^${name}: \\d+ bytes, 64x48,`, 'm'), `${name} decoded 64x48`);
  const webp = readFileSync(join(dir, 'probe.webp'));
  assert.equal(webp.toString('latin1', 0, 4), 'RIFF');
  assert.equal(webp.toString('latin1', 8, 12), 'WEBP');
  assert.equal(webp.readUInt32LE(4), webp.length - 8, 'the RIFF size is the file size');
  const chunks = [];
  for (let p = 12; p + 8 <= webp.length; ) {
    const len = webp.readUInt32LE(p + 4);
    chunks.push({ id: webp.toString('latin1', p, p + 4), data: webp.subarray(p + 8, p + 8 + len) });
    p += 8 + len + (len & 1);
  }
  assert.deepEqual(chunks.map((c) => c.id), ['VP8X', 'ALPH', 'VP8 ', 'EXIF'], 'the extended layout: VP8X, ALPH, VP8, EXIF');
  const vp8x = chunks[0].data;
  assert.ok(vp8x[0] & 0x08 && vp8x[0] & 0x10, 'VP8X flags EXIF and alpha');
  assert.equal(1 + vp8x.readUIntLE(4, 3), 64, 'VP8X canvas width');
  assert.equal(1 + vp8x.readUIntLE(7, 3), 48, 'VP8X canvas height');
  assert.equal(chunks[3].data.toString('latin1').replace(/\0+$/, ''), 'Exif\0\0homescoop libwebp probe');
}
