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

export default async function (ctx) {
  const { run, assert } = ctx;
  const wasm = new WebAssembly.Module(member(tarball(), 'package/bin/coreutils.wasm'));
  const imports = WebAssembly.Module.imports(wasm).map((i) => `${i.module}.${i.name}`);
  assert.ok(imports.includes('env.__syscall_linkat'), 'coreutils.wasm imports env.__syscall_linkat (the slicc shim beats libc\'s weak stub)');
  const sh = async (script) => {
    const r = await run(['bash', '-c', script], { cwd: '/tmp' });
    assert.equal(r.status, 0, `${script}: rc=${r.status} ${r.stdout}${r.stderr}`);
    return r.stdout.trim();
  };
  await sh('mkdir -p /mnt/lt && mount -t tmpfs none /mnt/lt');
  const out = await sh([
    'cd /mnt/lt && echo a > a && echo r > /tmp/lr',
    'ln a b 2>&1; echo "ln=$?"',
    'stat -c "%h %i" a b 2>&1 | tr "\\n" " "; echo',
    'echo c > c && ln -f a c 2>&1; echo "ln-f=$?"; cat c',
    'cp -l a d 2>&1; echo "cp-l=$?"',
    'ln /tmp/lr /tmp/lr2 2>&1; echo "root=$?"',
    'ln a /tmp/lx 2>&1; echo "cross=$?"',
  ].join('; '));
  await sh('umount /mnt/lt');
  const lines = out.split('\n');
  const real = lines[0] === 'ln=0';
  if (process.env.COREUTILS_LINKAT === '1') assert.ok(real, `COREUTILS_LINKAT=1 but: ${out}`);
  if (real) {
    const [ia, ib] = [...lines[1].matchAll(/(\d+) (\d+)/g)].map((m) => m.slice(1));
    assert.deepEqual([ia[0], ib[0], ia[1] === ib[1]], ['2', '2', true], `after ln a b, a and b share the inode with nlink 2: ${out}`);
  }
  const want = real
    ? [
        'ln=0',
        null,
        'ln-f=0',
        'a',
        'cp-l=0',
        "ln: failed to create hard link to '/tmp/lr': Too many links",
        'root=1',
        "ln: failed to create hard link '/tmp/lx' => 'a': Cross-device link",
        'cross=1',
      ]
    : [
        "ln: failed to create hard link to 'a': Too many links",
        'ln=1',
        null,
        "ln: failed to create hard link to 'a': Too many links",
        'ln-f=1',
        'c',
        "cp: cannot create hard link 'd' to 'a': Too many links",
        'cp-l=1',
        "ln: failed to create hard link to '/tmp/lr': Too many links",
        'root=1',
        "ln: failed to create hard link to 'a': Too many links",
        'cross=1',
      ];
  assert.equal(lines.length, want.length, out);
  want.forEach((w, i) => w === null || assert.equal(lines[i], w, `line ${i}: ${out}`));
  console.log(`linkat: imports env.__syscall_linkat; ${real ? 'kernel links: ln/ln -f/cp -l in tmpfs share an inode, the OPFS root is EMLINK, tmpfs → root EXDEV' : 'a kernel without the linkat wrapper: ln/ln -f/cp -l are EMLINK (Too many links), as before'}`);
}
