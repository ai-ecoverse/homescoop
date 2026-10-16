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

// slicc-kernel answers env.__syscall_uname from 1.98.0 on (slicc-kernel#625,
// #701); older kernels leave the shim's default body (Emscripten's values).
const ANSWERS = [1, 98, 0];
const atLeast = (v, want) => {
  for (let i = 0; i < want.length; i++) if (v[i] !== want[i]) return v[i] > want[i];
  return true;
};

export default async function (ctx) {
  const { run, assert } = ctx;
  const bytes = member(tarball(), 'package/bin/coreutils.wasm');
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(bytes)).map((i) => `${i.module}.${i.name}`);
  assert.ok(imports.includes('env.__syscall_uname'), 'coreutils.wasm does not import env.__syscall_uname, so no kernel can answer uname() (shims/slicc, slicc-kernel#625)');
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(!/\.cache\/emsdk|Caches\/emsdk|emsdk\/0\.4\.0/.test(text), 'coreutils.wasm names the emsdk cache directory (homescoop#358 maps it to /emsdk)');
  assert.ok(text.includes('/emsdk/emscripten/'), 'coreutils.wasm has no /emsdk/ paths at all');
  const fields = ['-s', '-n', '-r', '-v', '-m', '-o'];
  const r = await run(['bash', '-c', [
    ...fields.map((f) => `uname ${f}`),
    'hostname',
    ...['sys/kernel/ostype', 'sys/kernel/osrelease', 'version', 'sys/kernel/hostname'].map((f) => `cat /proc/${f} 2>/dev/null || echo "(no /proc/${f})"`),
  ].join('; ')], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} ${r.stdout}${r.stderr}`);
  const lines = r.stdout.split('\n');
  assert.equal(lines.length, 12, `uname fields, hostname and /proc: ${JSON.stringify(r.stdout)}`);
  const [s, n, rel, v, m, o, host, ostype, osrelease, procVersion, procHost] = lines;
  const kv = /\(slicc-kernel (\d+)\.(\d+)\.(\d+)\)/.exec(procVersion)?.slice(1).map(Number);
  const answers = kv ? atLeast(kv, ANSWERS) : false;
  // uname -a, byte for byte: the fields joined by one space, printable ASCII
  // only (each utsname field NUL-terminated within its 65 bytes, no stray bytes).
  const a = await run(['uname', '-a'], { cwd: '/tmp' });
  assert.equal(a.status, 0, `uname -a rc=${a.status} ${a.stderr}`);
  assert.ok(/^[\x20-\x7e]+\n$/.test(a.stdout), `uname -a has bytes outside printable ASCII: ${JSON.stringify(a.stdout)}`);
  if (s === 'Linux') {
    assert.equal(s, ostype, `uname -s against /proc/sys/kernel/ostype: ${r.stdout}`);
    assert.equal(rel, osrelease, `uname -r against /proc/sys/kernel/osrelease: ${r.stdout}`);
    // /proc/version: "Linux version <release> (slicc-kernel x.y.z) <version>".
    const pv = /^Linux version (\S+) \(slicc-kernel [^)]*\) (.+)$/.exec(procVersion);
    assert.ok(pv, `/proc/version: ${procVersion}`);
    assert.equal(rel, pv[1], `uname -r against /proc/version: ${r.stdout}`);
    assert.equal(v, pv[2], `uname -v against /proc/version's version: ${r.stdout}`);
    assert.ok(n.length > 0 && n.length <= 64, `uname -n: ${JSON.stringify(n)}`);
    assert.equal(n, host, `uname -n against hostname: ${r.stdout}`);
    if (!procHost.startsWith('(no ')) assert.equal(n, procHost, `uname -n against /proc/sys/kernel/hostname: ${r.stdout}`);
    assert.equal(m, 'wasm32', `uname -m: ${r.stdout}`);
    // -o is coreutils' own, fixed when it was configured (gnulib's
    // HOST_OPERATING_SYSTEM for the emscripten host), not a utsname field.
    assert.equal(o, 'Emscripten', `uname -o: ${r.stdout}`);
    assert.equal(a.stdout, `${[s, n, rel, v, m, o].join(' ')}\n`, `uname -a against the single fields: ${a.stdout}`);
  } else {
    assert.ok(!answers, `uname -s is ${s} on slicc-kernel ${kv?.join('.')}, which answers env.__syscall_uname (>= ${ANSWERS.join('.')}): ${r.stdout}`);
    assert.deepEqual([s, rel, v, m], ['Emscripten', '4.0.23', '#1', 'wasm32'], `uname without a kernel answer: ${r.stdout}`);
  }
  console.log(`uname: ${[s, n, rel, v, m, o].join(' ')} on ${kv ? `slicc-kernel ${kv.join('.')}` : procVersion} (osrelease ${osrelease}${procHost.startsWith('(no ') ? '' : `, /proc/sys/kernel/hostname ${procHost}`}); env.__syscall_uname imported; emsdk paths are /emsdk`);
}
