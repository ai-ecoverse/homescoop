export async function pagePut(path, b64) {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  let dir = await navigator.storage.getDirectory();
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(bytes);
  await w.close();
  return bytes.length;
}

export async function pageReadB64(path) {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  try {
    let dir = await navigator.storage.getDirectory();
    for (const p of parts) dir = await dir.getDirectoryHandle(p);
    const bytes = new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    return btoa(s);
  } catch {
    return null;
  }
}

export async function pagePngDigest(path, fixes, probes) {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  let buf;
  try {
    let dir = await navigator.storage.getDirectory();
    for (const p of parts) dir = await dir.getDirectoryHandle(p);
    buf = new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer());
  } catch {
    return null;
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error(`${path}: not a PNG`);
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]);
    if (type === 'IHDR') {
      ihdr = { width: dv.getUint32(off + 8), height: dv.getUint32(off + 12), depth: buf[off + 16], colorType: buf[off + 17], interlace: buf[off + 20] };
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(off + 8, off + 8 + len));
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (!ihdr || ihdr.interlace) throw new Error(`${path}: unsupported PNG`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.colorType];
  const bytesPerSample = ihdr.depth / 8;
  const bpp = channels * bytesPerSample;
  const stride = ihdr.width * bpp;
  const raw = new Uint8Array(await new Response(new Blob(idat).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const px = new Uint8Array(stride * ihdr.height);
  for (let y = 0; y < ihdr.height; y++) {
    const f = raw[y * (stride + 1)];
    const s0 = y * (stride + 1) + 1;
    const r0 = y * stride;
    const p0 = r0 - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[r0 + x - bpp] : 0;
      const b = y ? px[p0 + x] : 0;
      const c = y && x >= bpp ? px[p0 + x - bpp] : 0;
      let v = raw[s0 + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[r0 + x] = v & 255;
    }
  }
  const get = (i) => (bytesPerSample === 2 ? (px[2 * i] << 8) | px[2 * i + 1] : px[i]);
  const set = (i, v) => {
    if (bytesPerSample === 2) {
      px[2 * i] = v >> 8;
      px[2 * i + 1] = v & 255;
    } else {
      px[i] = v;
    }
  };
  const probed = probes.map(([x, y]) => Array.from({ length: channels }, (_, k) => get((y * ihdr.width + x) * channels + k)));
  let worst = 0;
  for (const [i, v] of fixes) {
    const d = Math.abs(get(i) - v);
    if (d > worst) worst = d;
    set(i, v);
  }
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', px));
  return {
    width: ihdr.width,
    height: ihdr.height,
    depth: ihdr.depth,
    colorType: ihdr.colorType,
    samples: px.length / bytesPerSample,
    worst,
    probes: probed,
    sha256: Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join(''),
  };
}
