export function jpegSize(buf) {
  if (!buf || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG');
  let off = 2;
  while (off < buf.length) {
    if (buf[off] !== 0xff) throw new Error(`bad JPEG marker at ${off}`);
    const m = buf[off + 1];
    const len = buf.readUInt16BE(off + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { width: buf.readUInt16BE(off + 7), height: buf.readUInt16BE(off + 5) };
    }
    off += 2 + len;
  }
  throw new Error('no SOF');
}

export function exifOrientation(buf) {
  const mm = buf.indexOf(Buffer.from('4d4d002a', 'hex'));
  const ii = buf.indexOf(Buffer.from('49492a00', 'hex'));
  const t = [mm, ii].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (t === undefined) return null;
  const le = buf[t] === 0x49;
  const u16 = (o) => (le ? buf.readUInt16LE(t + o) : buf.readUInt16BE(t + o));
  const u32 = (o) => (le ? buf.readUInt32LE(t + o) : buf.readUInt32BE(t + o));
  const ifd = u32(4);
  const n = u16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + 12 * k;
    if (u16(e) === 0x0112) return u16(e + 8);
  }
  return null;
}
