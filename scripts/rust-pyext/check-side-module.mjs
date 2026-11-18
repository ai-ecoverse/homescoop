#!/usr/bin/env node
// Check a Rust CPython extension side module before it's staged
// (scripts/rust-pyext.sh, homescoop_rust_pyext_check):
//
//   node scripts/rust-pyext/check-side-module.mjs <module.so> <python.wasm> <module name> [--metrics <wasm-opt --metrics output>] [--own <regex>]
//
// - it has a dylink.0 section, so slicc-kernel's dlopen takes it;
// - it exports PyInit_<module> or PyModExport_<module> (PEP 793, what pyo3
//   0.29 exports on 3.15), and the TLS entry points the kernel calls on
//   each new thread (__wasix_init_tls, __wasm_init_tls, __tls_base);
// - every env.* function and GOT.* import is exported by python.wasm or by
//   the module itself (or is weak), so no call traps with "unresolved
//   symbol" at run time: rust-lld links with --unresolved-symbols=import-dynamic,
//   so a libc or C-API function python.wasm doesn't export would otherwise
//   only fail when it's called;
// - with --own <regex>, no import whose name matches it: a static library
//   linked into the module (OpenSSL) binds its own definitions, never
//   python.wasm's exported copy;
// - with --metrics, no exception-handling instruction: python.wasm uses
//   legacy wasm EH, the wasm32-wasmer-wasi-dl target emits exnref, and its
//   std is panic=abort, so the module should have neither.
import { readFileSync } from 'node:fs';

const [so, pyWasm, mod, ...rest] = process.argv.slice(2);
if (!so || !pyWasm || !mod) {
  console.error('usage: check-side-module.mjs <module.so> <python.wasm> <module name> [--metrics <file>] [--own <regex>]');
  process.exit(2);
}
const mi = rest.indexOf('--metrics');
const metrics = mi >= 0 ? readFileSync(rest[mi + 1], 'utf8') : null;
const oi = rest.indexOf('--own');
const ownRe = oi >= 0 ? new RegExp(rest[oi + 1]) : null;

function weakImports(buf) {
  const weak = new Set();
  let p = 8;
  const u32 = () => { let r = 0, s = 0, b; do { b = buf[p++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return r >>> 0; };
  const str = () => { const n = u32(); const s = buf.toString('utf8', p, p + n); p += n; return s; };
  while (p < buf.length) {
    const id = buf[p++];
    const size = u32();
    const end = p + size;
    if (id === 0 && str() === 'dylink.0') {
      while (p < end) {
        const t = buf[p++];
        const l = u32();
        const e = p + l;
        if (t === 4) for (let n = u32(); n > 0; n--) { str(); const f = str(); if (u32() & 1) weak.add(f); }
        p = e;
      }
      return weak;
    }
    p = end;
  }
  return null;
}

const buf = readFileSync(so);
const m = new WebAssembly.Module(buf);
const problems = [];
const weak = weakImports(buf);
if (!weak) problems.push('no dylink.0 section: not a side module');
const own = new Set(WebAssembly.Module.exports(m).map((e) => e.name));
if (!own.has(`PyInit_${mod}`) && !own.has(`PyModExport_${mod}`)) problems.push(`exports neither PyInit_${mod} nor PyModExport_${mod} (PEP 793)`);
for (const need of ['__wasix_init_tls', '__wasm_init_tls', '__tls_base']) {
  if (!own.has(need)) problems.push(`does not export ${need}`);
}
const py = new Set(WebAssembly.Module.exports(new WebAssembly.Module(readFileSync(pyWasm))).map((e) => e.name));
const imports = WebAssembly.Module.imports(m);
const unresolved = imports.filter((i) => ((i.module === 'env' && i.kind === 'function') || i.module.startsWith('GOT.'))
  && !py.has(i.name) && !own.has(i.name) && !weak?.has(i.name));
for (const i of unresolved) problems.push(`${i.module}.${i.name}: not exported by python.wasm`);
if (ownRe) {
  // A library linked in statically must bind to itself (-Bsymbolic): an
  // import of one of its names would resolve to python.wasm's copy instead.
  for (const i of imports.filter((i) => (i.module === 'env' || i.module.startsWith('GOT.')) && ownRe.test(i.name))) {
    problems.push(`${i.module}.${i.name}: imported, but the module links its own (--own ${ownRe.source})`);
  }
}
const tags = imports.filter((i) => i.kind === 'tag').map((i) => i.name);
if (metrics) {
  for (const op of ['Try', 'TryTable', 'Throw', 'ThrowRef', 'Rethrow']) {
    const n = Number((metrics.match(new RegExp(`^ *${op} +: +(\\d+)`, 'm')) || [])[1] || 0);
    if (n) problems.push(`${n} ${op} instructions (python.wasm is legacy EH; the module should have none)`);
  }
}
const count = (mod) => imports.filter((i) => i.module === mod).length;
console.log(`rust-pyext: ${so.split('/').pop()}: ${imports.length} imports (env ${count('env')}, GOT.mem ${count('GOT.mem')}, GOT.func ${count('GOT.func')}, wasi ${count('wasi_snapshot_preview1')}, wasix ${count('wasix_32v1')}), tags [${tags.join(', ')}], ${own.size} exports`);
if (problems.length) {
  for (const p of problems) console.error(`rust-pyext: FAIL ${p}`);
  process.exit(1);
}
console.log(`rust-pyext: PASS ${mod}: every import resolves against python.wasm${metrics ? ', no EH instructions' : ''}`);
