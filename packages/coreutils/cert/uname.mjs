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
  const bytes = member(tarball(), 'package/bin/coreutils.wasm');
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(bytes)).map((i) => `${i.module}.${i.name}`);
  assert.ok(imports.includes('env.__syscall_uname'), 'coreutils.wasm imports env.__syscall_uname (slicc-kernel#625)');
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(!/\.cache\/emsdk|Caches\/emsdk|emsdk\/0\.4\.0/.test(text), 'coreutils.wasm names the emsdk cache directory (homescoop#358 maps it to /emsdk)');
  assert.ok(text.includes('/emsdk/emscripten/'), 'coreutils.wasm has no /emsdk/ paths at all');
  const r = await run(['bash', '-c', 'uname -s; uname -r; uname -v; uname -m; cat /proc/sys/kernel/osrelease'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} ${r.stdout}${r.stderr}`);
  const [s, rel, v, m, osrelease] = r.stdout.trim().split('\n');
  if (s === 'Linux') {
    assert.equal(rel, osrelease, `uname -r against /proc/sys/kernel/osrelease: ${r.stdout}`);
    assert.equal(m, 'wasm32', `uname -m: ${r.stdout}`);
  } else {
    assert.deepEqual([s, rel, v, m], ['Emscripten', '4.0.23', '#1', 'wasm32'], `uname without a kernel answer: ${r.stdout}`);
  }
  console.log(`uname: ${[s, rel, v, m].join(' ')} (osrelease ${osrelease}); env.__syscall_uname imported; emsdk paths are /emsdk`);
}
