#!/usr/bin/env node
// Side-module ABI check (homescoop#181): every env.* / GOT.* import of every
// native extension in the published py-* packages (test/side-modules.json,
// sha-pinned) must be exported by python.wasm, or by another side module of
// the same package set (dylink.0 needed libraries such as libopenblas).
//
//   node packages/wasix-python/test/side-abi.mjs --wasm <python.wasm> [--base <old python.wasm>] [--report <file.md>]
//
// --base lists what an older python.wasm (the published one) exported that
// the side modules use, so a report can say which symbols moved.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
if (!opt('--wasm')) {
  console.error('usage: side-abi.mjs --wasm <python.wasm> [--base <python.wasm>] [--report <file.md>]');
  process.exit(2);
}

/** Imports and exports of a wasm module (names only, with kinds). */
export function wasmSymbols(buf) {
  let p = 8;
  const u32 = () => { let r = 0, s = 0, b; do { b = buf[p++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return r >>> 0; };
  const str = () => { const n = u32(); const s = buf.toString('utf8', p, p + n); p += n; return s; };
  const limits = () => { const f = u32(); u32(); if (f & 1) u32(); };
  const imports = [];
  const exports = [];
  if (buf.readUInt32LE(0) !== 0x6d736100) throw new Error('not wasm');
  while (p < buf.length) {
    const id = buf[p++];
    const size = u32();
    const end = p + size;
    if (id === 2) {
      for (let n = u32(); n > 0; n--) {
        const module = str(); const name = str(); const kind = buf[p++];
        if (kind === 0) u32();
        else if (kind === 1) { p++; limits(); }
        else if (kind === 2) limits();
        else if (kind === 3) { p++; p++; }
        else if (kind === 4) { p++; u32(); }
        imports.push({ module, name, kind });
      }
    } else if (id === 7) {
      for (let n = u32(); n > 0; n--) { const name = str(); const kind = buf[p++]; u32(); exports.push({ name, kind }); }
    }
    p = end;
  }
  return { imports, exports };
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    const st = statSync(f);
    if (st.isDirectory()) walk(f, out);
    else if (e.endsWith('.so') || /\.so\.\d/.test(e)) out.push(f);
  }
  return out;
}

const OPENSSL = /^(EVP_|SSL_|SSL$|OPENSSL_|CRYPTO_|BIO_|BN_|RSA_|EC_|ERR_|X509|PEM_|RAND_|HMAC|SHA\d|MD5|ASN1_|OBJ_|PKCS|DH_|DSA_|ENGINE_|OSSL_)/;
const SKIP = new Set(['memory', '__indirect_function_table', '__stack_pointer', '__memory_base', '__table_base']);

const main = wasmSymbols(readFileSync(opt('--wasm')));
const mainExports = new Set(main.exports.map((e) => e.name));
// Shared host imports (EH tags __cpp_exception/__c_longjmp, ...): the loader
// gives side modules the same instance python.wasm imports.
const mainEnvImports = new Set(main.imports.filter((i) => i.module === 'env').map((i) => i.name));
// thread_local data that a side module takes for plain data (homescoop#192:
// libunwind's __wasm_lpad_context became thread_local in wasix-sysroot -14's
// runtimes). A PIE main exports a TLS symbol as its offset in the TLS block,
// which a side module adds to __tls_base only if it was built knowing the
// symbol is TLS; otherwise it reads and writes the wrong memory. Names with
// Itanium TLS wrappers (_ZTH<len><name> / _ZTW<len><name>) among main's
// imports and exports are thread_local; side-modules.json lists those the
// side modules were built against, and any other one they import through
// GOT.mem fails.
const tlsName = (n) => { const m = /^_ZT[HW](\d+)(.*)$/.exec(n); return m && m[2].length === Number(m[1]) ? m[2] : null; };
const mainTls = new Set([...main.exports.map((e) => e.name), ...main.imports.map((i) => i.name)].map(tlsName).filter(Boolean));
const base = opt('--base') ? new Set(wasmSymbols(readFileSync(opt('--base'))).exports.map((e) => e.name)) : null;
const manifest = JSON.parse(readFileSync(join(here, 'side-modules.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'side-abi-'));
const lines = [];
let missingTotal = 0;
const tlsMem = [];
try {
  // Unpack every pinned package; side modules may satisfy each other.
  const mods = [];
  for (const pkg of manifest.packages) {
    const tgz = join(work, `${pkg.name.replace('@ai-ecoverse/', '')}-${pkg.version}.tgz`);
    const res = await fetch(pkg.tarball);
    if (!res.ok) throw new Error(`fetch ${pkg.tarball}: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== pkg.sha256) throw new Error(`${pkg.name}@${pkg.version}: sha256 ${sha} != pinned ${pkg.sha256}`);
    writeFileSync(tgz, bytes);
    const dir = join(work, pkg.name.replace('@ai-ecoverse/', ''));
    execFileSync('mkdir', ['-p', dir]);
    execFileSync('tar', ['xzf', tgz, '-C', dir]);
    for (const f of walk(dir)) {
      const buf = readFileSync(f);
      if (buf.length < 8 || buf.readUInt32LE(0) !== 0x6d736100) continue;
      mods.push({ pkg, file: relative(dir, f), ...wasmSymbols(buf) });
    }
  }
  const sideExports = new Map();
  for (const m of mods) for (const e of m.exports) if (!sideExports.has(e.name)) sideExports.set(e.name, m.file);

  lines.push(`python.wasm: ${mainExports.size} exports${base ? `; base: ${base.size}` : ''}`, '');
  lines.push('| package | side modules | symbols from python.wasm | missing | OpenSSL symbols from python.wasm |', '| --- | --- | --- | --- | --- |');
  const fromMainAll = new Set();
  for (const pkg of manifest.packages) {
    const own = mods.filter((m) => m.pkg === pkg);
    const need = new Set();
    for (const m of own) {
      for (const i of m.imports) {
        if (i.module === 'env' && !SKIP.has(i.name)) need.add(i.name);
        else if (i.module === 'GOT.mem' || i.module === 'GOT.func') need.add(i.name);
        if (i.module === 'GOT.mem' && mainTls.has(i.name) && !manifest.thread_local.includes(i.name)) {
          tlsMem.push(`${m.file}: GOT.mem.${i.name}`);
        }
      }
    }
    const fromMain = [...need].filter((s) => mainExports.has(s));
    const missing = [...need].filter((s) => !mainExports.has(s) && !sideExports.has(s) && !mainEnvImports.has(s)).sort();
    const ssl = fromMain.filter((s) => OPENSSL.test(s)).sort();
    for (const s of fromMain) fromMainAll.add(s);
    missingTotal += missing.length;
    lines.push(`| ${pkg.name}@${pkg.version} | ${own.length} | ${fromMain.length} | ${missing.length ? missing.join(' ') : '0'} | ${ssl.length ? ssl.join(' ') : '—'} |`);
  }
  if (base) {
    const lost = [...fromMainAll].filter((s) => !mainExports.has(s));
    const viaBase = [...fromMainAll].filter((s) => !base.has(s));
    lines.push('', `Used symbols the base did not export: ${viaBase.length ? viaBase.sort().join(' ') : 'none'}`);
    lines.push(`Used symbols the base exported and this python.wasm does not: ${lost.length ? lost.sort().join(' ') : 'none'}`);
  }
  const mainSsl = [...mainExports].filter((s) => OPENSSL.test(s));
  lines.push('', `python.wasm exports ${mainSsl.length} OpenSSL-named symbols.`);
  lines.push('', `GOT.mem imports of python.wasm thread_local data: ${tlsMem.length ? tlsMem.join(', ') : 'none'}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
const report = lines.join('\n') + '\n';
process.stdout.write(report);
if (opt('--report')) writeFileSync(opt('--report'), report);
if (tlsMem.length) {
  console.error(`side-abi: ${tlsMem.length} side-module GOT.mem imports resolve to thread_local data of python.wasm`);
  process.exitCode = 1;
}
if (missingTotal) {
  console.error(`side-abi: ${missingTotal} side-module imports unresolved`);
  process.exit(1);
}
