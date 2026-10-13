import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const SIG = '89504e470d0a1a0a';
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function decodePng(buf) {
  if (buf.subarray(0, 8).toString('hex') !== SIG) throw new Error('not a PNG');
  let off = 8;
  let ihdr = null;
  const idat = [];
  const chunks = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    chunks.push(type);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (!ihdr) throw new Error('no IHDR');
  if (ihdr.interlace) throw new Error('interlaced PNG not supported');
  const channels = CHANNELS[ihdr.colorType];
  if (!channels) throw new Error(`colour type ${ihdr.colorType} not supported`);
  const bpp = channels * (ihdr.depth / 8);
  const stride = ihdr.width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * ihdr.height);
  for (let y = 0; y < ihdr.height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = px.subarray(y * stride, (y + 1) * stride);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (f !== 0) throw new Error(`bad filter ${f}`);
      row[x] = v & 255;
    }
  }
  let samples = px;
  if (ihdr.depth === 16) {
    samples = new Uint16Array(px.length / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = px.readUInt16BE(i * 2);
  }
  return { ...ihdr, channels, pixels: px, samples, chunks };
}

export function pixelSha(img) {
  return createHash('sha256').update(img.pixels).digest('hex');
}

export function maxDiff(a, b) {
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels || a.depth !== b.depth) {
    throw new Error(`shape ${a.width}x${a.height}x${a.channels}@${a.depth} != ${b.width}x${b.height}x${b.channels}@${b.depth}`);
  }
  let m = 0;
  for (let i = 0; i < a.samples.length; i++) {
    const d = Math.abs(a.samples[i] - b.samples[i]);
    if (d > m) m = d;
  }
  return m;
}
