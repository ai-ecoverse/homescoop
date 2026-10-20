// Helpers for packages/zip/cert/*.mjs (a subdirectory, so run.mjs does not
// take this file for a spec). Needs wasm-bash and wasm-coreutils (base64).
import { crc32 } from 'node:zlib';

export const USER = 'cone';
export const HOME = '/home/cone';

/** bash -c `script` as cone in `cwd` (default ~). */
export function sh(ctx, script, cwd = HOME) {
  return ctx.run(['bash', '-c', script], { cwd, user: USER });
}

/** The bytes of a file in the kernel (ctx.read is text only). */
export async function readBytes(ctx, path) {
  const r = await ctx.run(['base64', '-w0', path], { cwd: HOME, user: USER });
  ctx.assert.equal(r.status, 0, `base64 ${path}: rc ${r.status}\n${r.stderr}`);
  return Buffer.from(r.stdout, 'base64');
}

/** Write bytes to `path` in the kernel, as cone (ctx.write is text only). */
export async function writeBytes(ctx, path, bytes) {
  const b64 = `/tmp/zipkit/${path.replace(/[^A-Za-z0-9]/g, '_')}.b64`;
  await ctx.write(b64, Buffer.from(bytes).toString('base64'));
  const r = await sh(ctx, `base64 -d '${b64}' > '${path}'`);
  ctx.assert.equal(r.status, 0, `base64 -d > ${path}: rc ${r.status}\n${r.stderr}`);
}

/**
 * A zip of stored entries, written by hand so a spec controls every byte:
 * entries are { name: Buffer, data: Buffer, flags?: number, extra?: Buffer }.
 * Optional, per entry: method (the header's compression method, the data is
 * still written as given), madeBy (the central "version made by" word),
 * csize/usize (header sizes), sameAs (an entry's index in `entries`, or its
 * name: this central entry points at that entry's local header and has none
 * of its own). Options: zip64Eocd: { totalDisks } appends a zip64 end of
 * central directory record and locator, as Windows writes them (it puts 0
 * in the locator's total disks, homescoop#652).
 */
export function storedZip(entries, options = {}) {
  const locals = [];
  const centrals = [];
  const offsets = new Map();
  const target = (ref) => {
    const i = typeof ref === 'number' ? ref : entries.findIndex((x) => x.sameAs === undefined && Buffer.from(x.name).equals(Buffer.from(ref)));
    if (!offsets.has(i)) throw new Error(`sameAs ${String(ref)}: no earlier entry with its own local header`);
    return offsets.get(i);
  };
  let off = 0;
  for (const [index, e] of entries.entries()) {
    const flags = e.flags ?? 0;
    const extra = e.extra ?? Buffer.alloc(0);
    const crc = crc32(e.data);
    const method = e.method ?? 0;
    const csize = e.csize ?? e.data.length;
    const usize = e.usize ?? e.data.length;
    if (e.sameAs !== undefined) {
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0);
      ch.writeUInt16LE(e.madeBy ?? (3 << 8) | 30, 4);
      ch.writeUInt16LE(10, 6);
      ch.writeUInt16LE(flags, 8);
      ch.writeUInt16LE(method, 10);
      ch.writeUInt16LE((46 << 9) | (1 << 5) | 1, 14);
      ch.writeUInt32LE(crc, 16);
      ch.writeUInt32LE(csize, 20);
      ch.writeUInt32LE(usize, 24);
      ch.writeUInt16LE(e.name.length, 28);
      ch.writeUInt16LE(extra.length, 30);
      ch.writeUInt32LE((0o100644 << 16) >>> 0, 38);
      ch.writeUInt32LE(target(e.sameAs), 42);
      centrals.push(Buffer.concat([ch, e.name, extra]));
      continue;
    }
    offsets.set(index, off);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(10, 4); // version needed
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10); // time 00:00
    lh.writeUInt16LE((46 << 9) | (1 << 5) | 1, 12); // 2026-01-01
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(csize, 18);
    lh.writeUInt32LE(usize, 22);
    lh.writeUInt16LE(e.name.length, 26);
    lh.writeUInt16LE(extra.length, 28);
    const local = Buffer.concat([lh, e.name, extra, e.data]);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(e.madeBy ?? (3 << 8) | 30, 4); // made by Unix, 3.0
    ch.writeUInt16LE(10, 6);
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE((46 << 9) | (1 << 5) | 1, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(csize, 20);
    ch.writeUInt32LE(usize, 24);
    ch.writeUInt16LE(e.name.length, 28);
    ch.writeUInt16LE(extra.length, 30);
    ch.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
    ch.writeUInt32LE(off, 42);
    centrals.push(Buffer.concat([ch, e.name, extra]));
    locals.push(local);
    off += local.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(off, 16);
  if (!options.zip64Eocd) return Buffer.concat([...locals, cd, end]);
  const z64 = Buffer.alloc(56);
  z64.writeUInt32LE(0x06064b50, 0);
  z64.writeBigUInt64LE(44n, 4);
  z64.writeUInt16LE((3 << 8) | 45, 12);
  z64.writeUInt16LE(45, 14);
  z64.writeBigUInt64LE(BigInt(centrals.length), 24);
  z64.writeBigUInt64LE(BigInt(centrals.length), 32);
  z64.writeBigUInt64LE(BigInt(cd.length), 40);
  z64.writeBigUInt64LE(BigInt(off), 48);
  const loc = Buffer.alloc(20);
  loc.writeUInt32LE(0x07064b50, 0);
  loc.writeBigUInt64LE(BigInt(off + cd.length), 8);
  loc.writeUInt32LE(options.zip64Eocd.totalDisks ?? 1, 16);
  return Buffer.concat([...locals, cd, z64, loc, end]);
}

/** Info-ZIP's Unicode Path extra field (0x7075) for a raw local name. */
export function unicodePathExtra(rawName, utf8Name) {
  const head = Buffer.alloc(9);
  head.writeUInt16LE(0x7075, 0);
  head.writeUInt16LE(5 + utf8Name.length, 2);
  head.writeUInt8(1, 4);
  head.writeUInt32LE(crc32(rawName), 5);
  return Buffer.concat([head, utf8Name]);
}

/** [{ name, flags, at }] of every local file header, walking the archive. */
export function localHeaders(zip) {
  const out = [];
  let at = 0;
  while (at + 30 <= zip.length && zip.readUInt32LE(at) === 0x04034b50) {
    const flags = zip.readUInt16LE(at + 6);
    const nlen = zip.readUInt16LE(at + 26);
    const xlen = zip.readUInt16LE(at + 28);
    const csize = zip.readUInt32LE(at + 18);
    const name = zip.subarray(at + 30, at + 30 + nlen);
    out.push({ name: name.toString('utf8'), flags, at });
    if (flags & 8) break; // sizes in a data descriptor: stop walking
    at += 30 + nlen + xlen + csize;
  }
  return out;
}
