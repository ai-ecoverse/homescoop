// The libffi _cffi_backend uses is python.wasm's: every ffi_* symbol it needs
// is an import (functions from env, the ffi_type_* data through GOT.mem), and
// it defines or exports none, so there is no second libffi (and no second set
// of closure handlers) beside _ctypes'. Run by build.sh and test/backend.test.mjs.
import { readFileSync } from 'node:fs';

export function symbols(buf) {
  let p = 8;
  const u = () => { let r = 0, s = 0, b; do { b = buf[p++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return r; };
  const str = () => { const n = u(); const s = buf.toString('utf8', p, p + n); p += n; return s; };
  const limits = () => { const f = u(); u(); if (f & 1) u(); };
  const out = { imports: [], exports: [], dylink: false };
  if (buf.readUInt32LE(0) !== 0x6d736100) throw new Error('not a wasm module');
  while (p < buf.length) {
    const id = buf[p++];
    const size = u();
    const end = p + size;
    if (id === 0 && str() === 'dylink.0') out.dylink = true;
    if (id === 2) {
      for (let n = u(); n > 0; n--) {
        const module = str(), name = str(), kind = buf[p++];
        if (kind === 0) u();
        else if (kind === 1) { p++; limits(); }
        else if (kind === 2) limits();
        else if (kind === 3) p += 2;
        else if (kind === 4) { p++; u(); }
        out.imports.push({ module, name, kind });
      }
    }
    if (id === 7) {
      for (let n = u(); n > 0; n--) { const name = str(); const kind = buf[p++]; u(); out.exports.push({ name, kind }); }
    }
    p = end;
  }
  return out;
}

// What _cffi_backend.c calls in libffi (with CFFI_CHECK_FFI_* on, the WASIX patch).
export const FFI_FUNCS = ['ffi_call', 'ffi_prep_cif', 'ffi_prep_cif_var', 'ffi_closure_alloc', 'ffi_closure_free', 'ffi_prep_closure_loc'];

export function check(buf) {
  const s = symbols(buf);
  const problems = [];
  if (!s.dylink) problems.push('no dylink.0 section: not a side module');
  const fnImports = new Set(s.imports.filter((i) => i.module === 'env' && i.kind === 0).map((i) => i.name));
  const dataImports = new Set(s.imports.filter((i) => i.module === 'GOT.mem').map((i) => i.name));
  for (const f of FFI_FUNCS) if (!fnImports.has(f)) problems.push(`${f} is not imported from env`);
  const types = [...dataImports].filter((n) => n.startsWith('ffi_type_'));
  if (!types.includes('ffi_type_pointer') || !types.includes('ffi_type_double')) problems.push(`ffi_type_* globals not imported through GOT.mem (got ${types.join(', ') || 'none'})`);
  const defined = s.exports.filter((e) => /^ffi_/.test(e.name)).map((e) => e.name);
  if (defined.length) problems.push(`defines its own libffi: exports ${defined.join(', ')}`);
  return { problems, ffiImports: [...fnImports].filter((n) => n.startsWith('ffi_')).sort(), ffiTypes: types.sort() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let bad = 0;
  for (const f of process.argv.slice(2)) {
    const r = check(readFileSync(f));
    console.log(`${f}: imports ${r.ffiImports.join(', ')}; ${r.ffiTypes.length} ffi_type_* through GOT.mem${r.problems.length ? '' : '; no ffi_* of its own'}`);
    for (const x of r.problems) console.log(`  ${x}`);
    bad += r.problems.length;
  }
  process.exit(bad ? 1 : 0);
}
