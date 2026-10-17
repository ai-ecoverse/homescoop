import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

export default async function ({ assert, dir, stdout, version }) {
  assert.match(stdout, new RegExp(`^LIBTIFF, Version ${version.replaceAll('.', '\\.')}$`, 'm'), 'TIFFGetVersion is the recipe version');
  assert.match(stdout, /^jpeg max diff \d+$/m);
  const tif = readFileSync(join(dir, 'probe.tif'));
  assert.equal(tif.toString('latin1', 0, 4), 'II*\0', 'little-endian classic TIFF');
  let ifd = tif.readUInt32LE(4);
  const pages = [];
  while (ifd) {
    const n = tif.readUInt16LE(ifd);
    const tags = new Map();
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      const tag = tif.readUInt16LE(e);
      const type = tif.readUInt16LE(e + 2);
      const count = tif.readUInt32LE(e + 4);
      const val = type === 3 && count === 1 ? tif.readUInt16LE(e + 8) : tif.readUInt32LE(e + 8);
      tags.set(tag, { type, count, val });
    }
    pages.push(tags);
    ifd = tif.readUInt32LE(ifd + 2 + n * 12);
  }
  assert.deepEqual(pages.map((t) => t.get(259).val), [8, 5, 7, 32773], 'Compression tags: Adobe deflate, LZW, JPEG, PackBits');
  const deflate = pages[0];
  const off = deflate.get(273);
  const len = deflate.get(279);
  const first = off.count === 1 ? off.val : tif.readUInt32LE(off.val);
  const size = len.count === 1 ? len.val : tif.readUInt32LE(len.val);
  const strip = inflateSync(tif.subarray(first, first + size));
  assert.equal(strip.length, 32 * 3 * 8, "Node's zlib inflates the deflate page's first strip to 8 rows of 32 RGB pixels");
  assert.deepEqual([...strip.subarray(0, 3)], [0, 0, 128], 'its first pixel (horizontal predictor: stored as is)');
}
