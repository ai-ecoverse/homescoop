import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

function tarball() {
  if (process.env.CERT_TARBALL) return process.env.CERT_TARBALL;
  const i = process.argv.indexOf('--tarball');
  return i >= 0 ? process.argv[i + 1] : '.homescoop-out/package.tgz';
}

function member(tgz, want) {
  const buf = gunzipSync(readFileSync(tgz));
  for (let at = 0; at + 512 <= buf.length; ) {
    const h = buf.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(h.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
    if (name === want) return buf.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${want} not in ${tgz}`);
}

function header(name, { type = '0', size = 0, link = '', mode = 0o644 } = {}) {
  const h = Buffer.alloc(512);
  const put = (off, len, s) => h.write(s, off, len, 'ascii');
  const oct = (off, len, n) => put(off, len, `${n.toString(8).padStart(len - 1, '0')}\0`);
  put(0, 100, name);
  oct(100, 8, mode);
  oct(108, 8, 0);
  oct(116, 8, 0);
  oct(124, 12, size);
  oct(136, 12, 1700000000);
  h.fill(0x20, 148, 156);
  put(156, 1, type);
  put(157, 100, link);
  put(257, 6, 'ustar\0');
  put(263, 2, '00');
  let sum = 0;
  for (const b of h) sum += b;
  put(148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
  return h;
}

function hardLinkTar() {
  const body = Buffer.from('hello\n');
  const pad = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([
    header('hl/', { type: '5', mode: 0o755 }),
    header('hl/a', { size: body.length }),
    body,
    pad,
    header('hl/b', { type: '1', link: 'hl/a' }),
    Buffer.alloc(1024),
  ]);
}

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const wasm = new WebAssembly.Module(member(tarball(), 'package/bin/tar.wasm'));
  const imports = WebAssembly.Module.imports(wasm).map((i) => `${i.module}.${i.name}`);
  assert.ok(imports.includes('env.__syscall_linkat'), "tar.wasm imports env.__syscall_linkat (the slicc shim beats libc's weak stub)");
  const sh = async (script) => {
    const r = await run(['bash', '-c', script], { cwd: '/tmp' });
    return { status: r.status, out: `${r.stdout}${r.stderr}`.trim() };
  };
  await write('/tmp/tl/hl.tar', hardLinkTar());

  const list = await sh('tar -tvf /tmp/tl/hl.tar');
  assert.equal(list.status, 0, list.out);
  assert.match(list.out, /hl\/b link to hl\/a/, 'the archive has a hard-link member');

  const real = process.env.TAR_LINKAT === '1';
  if (!real) {
    const x = await sh('rm -rf /tmp/tl/x && mkdir /tmp/tl/x && cd /tmp/tl/x && tar -xf /tmp/tl/hl.tar; echo "rc=$?"; cat hl/a; ls hl');
    assert.match(x.out, /tar: hl\/b: Cannot hard link to [‘']hl\/a[’']: Too many links/, `no linkat wrapper: EMLINK: ${x.out}`);
    assert.match(x.out, /rc=2/, `tar -x exits 2: ${x.out}`);
    assert.match(x.out, /hello\n/, 'the regular member is still extracted');
    console.log("linkat: tar.wasm imports env.__syscall_linkat; no kernel wrapper: the hard-link member is EMLINK ('Too many links'), rc 2, the regular member extracted");
    return;
  }

  const m = await sh('mkdir -p /mnt/tl && mount -t tmpfs none /mnt/tl');
  assert.equal(m.status, 0, m.out);
  try {
    const x = await sh('cd /mnt/tl && mkdir x && cd x && tar -xf /tmp/tl/hl.tar; echo "rc=$?"; stat -c "%h %i" hl/a hl/b');
    const [rc, sa, sb] = x.out.split('\n');
    assert.equal(rc, 'rc=0', `1.90.0: tar -x of a hard-link member into tmpfs: ${x.out}`);
    const [na, ia] = sa.split(' ');
    const [nb, ib] = sb.split(' ');
    assert.deepEqual([na, nb, ia === ib], ['2', '2', true], `hl/a and hl/b share the inode with nlink 2: ${x.out}`);

    const cf = await sh('cd /mnt/tl && tar -cf c.tar -C x hl && tar -tvf c.tar');
    assert.equal(cf.status, 0, cf.out);
    assert.equal(cf.out.split('\n').filter((l) => / link to /.test(l)).length, 1, `tar -cf of the extracted pair stores the second name as a hard link: ${cf.out}`);
    const c = await sh('cd /mnt/tl && rm -rf y && mkdir y && cd y && tar -xf ../c.tar; echo "rc=$?"; stat -c "%h %i" hl/a hl/b; cat hl/b');
    const lines = c.out.split('\n');
    assert.equal(lines[0], 'rc=0', c.out);
    const [nf, i1] = lines[1].split(' ');
    const [ng, i2] = lines[2].split(' ');
    assert.deepEqual([nf, ng, i1 === i2, lines[3]], ['2', '2', true, 'hello'], `round trip keeps the link: ${c.out}`);

    const root = await sh('rm -rf /tmp/tl/r && mkdir /tmp/tl/r && cd /tmp/tl/r && tar -xf /tmp/tl/hl.tar; echo "rc=$?"');
    assert.match(root.out, /Cannot hard link to [‘']hl\/a[’']: Too many links/, `the OPFS root has no hard links: ${root.out}`);
    assert.match(root.out, /rc=2/);
    console.log('linkat (1.90.0): hard-link member extracts as a real link in tmpfs (nlink 2, same inode); tar -cf/-xf round trip keeps it; the OPFS root is EMLINK');
  } finally {
    await sh('umount /mnt/tl');
  }
}
