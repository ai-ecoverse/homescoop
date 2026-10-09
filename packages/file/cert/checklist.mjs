/**
 * file checklist (homescoop#123, PR #129): magic detection across ten types
 * (png, pdf, gzip, ELF, wasm, shebang script, UTF-8 text, JSON, zip, empty),
 * -b, -i / --mime-type, stdin, -z through the statically linked zlib, libbz2
 * and liblzma, and missing files. The fixtures are generated here; the ELF
 * object is binutils' x86-64 fixture, and the .bz2/.xz are tiny base64 blobs
 * from the host's bzip2 -9 and xz -9 ('xz me' would read as MGR bitmap magic).
 */
import { crc32, deflateSync, gzipSync } from 'node:zlib';

const ELF_X86_64 = 'f0VMRgIBAQAAAAAAAAAAAAEAPgABAAAAAAAAAAAAAAAAAAAAAAAAAMgBAAAAAAAAAAAAAEAAAAAAAEAACgABAIn4ifmD4QNIjRUAAAAAATyKAwUAAAAAwwAAAAAAAAAAaG9tZXNjb29wLWJpbnV0aWxzLWJhbm5lcgAAACoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABLAAAABADx/wAAAAAAAAAAAAAAAAAAAABEAAAAAQAGAAAAAAAAAAAAEAAAAAAAAAAAAAAAAwAGAAAAAAAAAAAAAAAAAAAAAAAMAAAAEgACAAAAAAAAAAAAGAAAAAAAAAAXAAAAEQAFAAAAAAAAAAAABAAAAAAAAAAfAAAAEQAEAAAAAAAAAAAAGgAAAAAAAAAKAAAAAAAAAAIAAAADAAAA/P////////8TAAAAAAAAAAIAAAAFAAAA/P////////8ALnJlbGEudGV4dABncmVldAAuYnNzAGNvdW50ZXIAYmFubmVyAC5ub3RlLkdOVS1zdGFjawAubGx2bV9hZGRyc2lnAHplcm9lZABvYmouYwAuc3RydGFiAC5zeW10YWIALnJvZGF0YQAuZGF0YQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFEAAAADAAAAAAAAAAAAAAAAAAAAAAAAAFgBAAAAAAAAbwAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAGAAAAAQAAAAYAAAAAAAAAAAAAAAAAAABAAAAAAAAAABgAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAQAAAAQAAABAAAAAAAAAAAAAAAAAAAAAKAEAAAAAAAAwAAAAAAAAAAkAAAACAAAACAAAAAAAAAAYAAAAAAAAAGEAAAABAAAAAgAAAAAAAAAAAAAAAAAAAGAAAAAAAAAAGgAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAABpAAAAAQAAAAMAAAAAAAAAAAAAAAAAAAB8AAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAEgAAAAgAAAADAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAACYAAAABAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAA2AAAAA0z/bwAAAIAAAAAAAAAAAAAAAABYAQAAAAAAAAAAAAAAAAAACQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAWQAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAACoAAAAAAAAAAEAAAAEAAAACAAAAAAAAAAYAAAAAAAAAA==';
const BZ2 = 'QlpoOTFBWSZTWR1JTQoAAAFRgAAQQAASIkAQIAAxDAghpo2o5kODxdyRThQkB1JTQoA=';
const XZ = '/Td6WFoAAAFpIt42BMAWEiEBHAAAAAAAAAAAAG7BVYkBABFwYWNrZWQgYnkgbGlibHptYQoAAADwt0nQAAEuEk/NONiQQpkNAQAAAAABWVo=';

function png() {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(3, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((1 + 9) * 2);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// gzipSync writes the host's OS byte (3 on Linux, 19 on macOS); pin it to
// Unix so the description is the same on every runner.
function gz(text) {
  const b = gzipSync(Buffer.from(text), { mtime: 0 });
  b[9] = 3;
  return b;
}

function zip() {
  const name = Buffer.from('hello.txt');
  const data = Buffer.from('hello zip\n');
  const crc = crc32(data);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(10, 4);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(data.length, 18);
  lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(10, 6);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(data.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(cd.length + name.length, 12);
  end.writeUInt32LE(lh.length + name.length + data.length, 16);
  return Buffer.concat([lh, name, data, cd, name, end]);
}

// name → [bytes, `file` description, `file -i` MIME]
const FX = {
  'img.png': [png(), 'PNG image data, 3 x 2, 8-bit/color RGB, non-interlaced', 'image/png; charset=binary'],
  'doc.pdf': [
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'),
    'PDF document, version 1.4',
    'application/pdf; charset=us-ascii',
  ],
  'data.gz': [gz('gzip me\n'), /^gzip compressed data, from Unix/, 'application/gzip; charset=binary'],
  'obj.o': [
    Buffer.from(ELF_X86_64, 'base64'),
    'ELF 64-bit LSB relocatable, x86-64, version 1 (SYSV), not stripped',
    'application/x-object; charset=binary',
  ],
  'mod.wasm': [Buffer.from('0061736d01000000', 'hex'), 'WebAssembly (wasm) binary module version 0x1 (MVP)', 'application/wasm; charset=binary'],
  'run.sh': [Buffer.from('#!/bin/sh\necho hi\n'), 'POSIX shell script, ASCII text executable', 'text/x-shellscript; charset=us-ascii'],
  'utf8.txt': [Buffer.from('héllo wörld — ünïcode\n'), 'Unicode text, UTF-8 text', 'text/plain; charset=utf-8'],
  'data.json': [Buffer.from('{"a": [1, 2, 3], "b": {"c": "d"}}\n'), 'JSON text data', 'application/json; charset=us-ascii'],
  'arch.zip': [zip(), /^Zip archive data, .*method=store$/, 'application/zip; charset=binary'],
  empty: [Buffer.alloc(0), 'empty', 'inode/x-empty; charset=binary'],
};

export default async function (ctx) {
  const { run, assert } = ctx;
  const cwd = '/home/file';
  const go = (argv) => run(argv, { cwd });
  const ok = async (argv) => {
    const r = await go(argv);
    assert.equal(r.status, 0, `${argv.join(' ')}: rc=${r.status} stderr=${r.stderr}`);
    return r;
  };
  const put = async (name, buf) => {
    const w = await run(['bash', '-c', `base64 -d > '${name}'`], { cwd, stdin: buf.toString('base64') });
    assert.equal(w.status, 0, `write ${name} stderr=${w.stderr}`);
  };
  const mk = await run(['mkdir', '-p', cwd], { cwd: '/home' });
  assert.equal(mk.status, 0, `mkdir stderr=${mk.stderr}`);
  for (const [name, [bytes]] of Object.entries(FX)) await put(name, bytes);
  await put('data.bz2', Buffer.from(BZ2, 'base64'));
  await put('data.xz', Buffer.from(XZ, 'base64'));

  const ver = await ok(['file', '--version']);
  assert.match(ver.stdout, /^file-5\.46$/m);
  assert.match(ver.stdout, /magic file from \/.*\/share\/misc\/magic\.mgc$/m);

  // All ten in one call, with name padding; then -b per file.
  const names = Object.keys(FX);
  const all = (await ok(['file', ...names])).stdout.split('\n').slice(0, -1);
  assert.equal(all.length, names.length, `file printed ${all.length} lines`);
  names.forEach((name, i) => {
    const [, desc] = FX[name];
    const m = all[i].match(/^([^:]+): +(.*)$/);
    assert.ok(m, `line ${all[i]}`);
    assert.equal(m[1], name);
    if (desc instanceof RegExp) assert.match(m[2], desc, name);
    else assert.equal(m[2], desc, name);
  });
  for (const name of names) {
    const [, desc] = FX[name];
    const b = (await ok(['file', '-b', name])).stdout.replace(/\n$/, '');
    if (desc instanceof RegExp) assert.match(b, desc, `-b ${name}`);
    else assert.equal(b, desc, `-b ${name}`);
  }

  // -i (MIME type + charset) and --mime-type.
  const mime = (await ok(['file', '-i', ...names])).stdout.split('\n').slice(0, -1);
  names.forEach((name, i) => assert.equal(mime[i].replace(/^[^:]+: +/, ''), FX[name][2], `-i ${name}`));
  for (const name of names) {
    const t = (await ok(['file', '--mime-type', '-b', name])).stdout;
    assert.equal(t, `${FX[name][2].split(';')[0]}\n`, `--mime-type ${name}`);
  }

  // stdin.
  const stdin = await ok(['bash', '-c', 'file - < img.png; cat doc.pdf | file -b -']);
  assert.equal(stdin.stdout, `/dev/stdin: ${FX['img.png'][1]}\n${FX['doc.pdf'][1]}\n`);

  // -z looks inside: zlib, libbz2 and liblzma are linked in.
  assert.equal((await ok(['file', '-b', '-z', 'data.gz'])).stdout, 'ASCII text (gzip compressed data, from Unix)\n');
  assert.match((await ok(['file', '-b', '-z', 'data.bz2'])).stdout, /^ASCII text \(bzip2 compressed data, block size = 900k\)$/m);
  assert.match((await ok(['file', '-b', '-z', 'data.xz'])).stdout, /^ASCII text \(XZ compressed data, checksum CRC32\)$/m);
  assert.equal((await ok(['file', '-b', 'data.xz'])).stdout, 'XZ compressed data, checksum CRC32\n');

  // Missing file: reported on stdout with rc 0, rc 1 with -E.
  const miss = await ok(['file', 'missing']);
  assert.equal(miss.stdout, "missing: cannot open `missing' (No such file or directory)\n");
  const missE = await go(['file', '-E', 'missing']);
  assert.equal(missE.status, 1, `-E missing rc=${missE.status}`);
  assert.match(missE.stdout, /ERROR: cannot stat `missing' \(No such file or directory\)/);
  const mixed = await ok(['file', '-b', 'img.png', 'missing']);
  assert.equal(mixed.stdout, `${FX['img.png'][1]}\ncannot open \`missing' (No such file or directory)\n`);
}
