import { readFileSync } from 'node:fs';

const METH_VARARGS = 0x1, METH_KEYWORDS = 0x2, METH_NOARGS = 0x4, METH_O = 0x8, METH_CLASS = 0x10, METH_STATIC = 0x20, METH_COEXIST = 0x40, METH_FASTCALL = 0x80, METH_METHOD = 0x200;

function wantParams(flags) {
  const f = flags & ~(METH_CLASS | METH_STATIC | METH_COEXIST);
  if (f === METH_NOARGS || f === METH_O || f === METH_VARARGS) return 2;
  if (f === (METH_VARARGS | METH_KEYWORDS)) return 3;
  if (f === METH_FASTCALL) return 3;
  if (f === (METH_FASTCALL | METH_KEYWORDS)) return 4;
  if (f === (METH_METHOD | METH_FASTCALL | METH_KEYWORDS)) return 5;
  return undefined;
}

export function parse(buf) {
  let p = 8;
  const u32 = () => { let r = 0, s = 0, b; do { b = buf[p++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return r; };
  const s32 = () => { let r = 0, s = 0, b; do { b = buf[p++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); if (s < 32 && (b & 0x40)) r |= -1 << s; return r; };
  const s64 = () => { let b; do { b = buf[p++]; } while (b & 0x80); };
  const str = () => { const n = u32(); const s = buf.toString('utf8', p, p + n); p += n; return s; };
  const results = [], types = [], funcTypes = [], funcNames = [], globals = [], exports = {}, elems = [], segs = [];
  let codeBodies = [], start;
  const limits = () => { const f = u32(); u32(); if (f & 1) u32(); };
  const constExpr = () => {
    const out = [];
    for (;;) {
      const op = buf[p++];
      if (op === 0x0b) return out;
      if (op === 0x41) out.push({ c: s32() });
      else if (op === 0x23) out.push({ g: u32() });
      else if (op === 0x6a) out.push({ add: true });
      else throw new Error('const op ' + op.toString(16));
    }
  };
  while (p < buf.length) {
    const id = buf[p++];
    const size = u32();
    const end = p + size;
    if (id === 0) {
      const name = str();
      if (name === 'name') {
        while (p < end) {
          const sub = buf[p++]; const sz = u32(); const se = p + sz;
          if (sub === 1) for (let n = u32(); n > 0; n--) { const i = u32(); funcNames[i] = str(); }
          p = se;
        }
      }
    } else if (id === 1) {
      for (let n = u32(); n > 0; n--) {
        const form = buf[p++];
        if (form !== 0x60) throw new Error('type form ' + form);
        const np = u32(); p += np; const nr = u32(); p += nr;
        types.push(np); results.push(nr);
      }
    } else if (id === 2) {
      for (let n = u32(); n > 0; n--) {
        const module = str(); const name = str(); const kind = buf[p++];
        if (kind === 0) { funcNames[funcTypes.length] = `${module}.${name}`; funcTypes.push(u32()); }
        else if (kind === 1) { p++; limits(); }
        else if (kind === 2) limits();
        else if (kind === 3) { p++; p++; globals.push(`${module}.${name}`); }
        else if (kind === 4) { p++; u32(); }
      }
    } else if (id === 3) {
      for (let n = u32(); n > 0; n--) funcTypes.push(u32());
    } else if (id === 6) {
      for (let n = u32(); n > 0; n--) { p++; p++; constExpr(); globals.push(null); }
    } else if (id === 7) {
      for (let n = u32(); n > 0; n--) { const name = str(); const kind = buf[p++]; const idx = u32(); if (kind === 0) exports[name] = idx; }
    } else if (id === 8) {
      start = u32();
    } else if (id === 9) {
      for (let n = u32(); n > 0; n--) {
        const flag = u32();
        if (flag !== 0) throw new Error('elem flag ' + flag);
        const off = constExpr();
        const fns = [];
        for (let k = u32(); k > 0; k--) fns.push(u32());
        elems.push({ off, fns });
      }
    } else if (id === 10) {
      const n = u32();
      for (let i = 0; i < n; i++) { const sz = u32(); codeBodies.push([p, p + sz]); p += sz; }
    } else if (id === 11) {
      for (let n = u32(); n > 0; n--) {
        const flag = u32();
        let off;
        if (flag === 0) off = constExpr();
        else if (flag === 2) { u32(); off = constExpr(); }
        const len = u32();
        segs.push({ off, bytes: buf.subarray(p, p + len) });
        p += len;
      }
    }
    p = end;
  }
  const nImported = funcTypes.length - codeBodies.length;
  const params = (fi) => types[funcTypes[fi]];
  const gname = (g) => globals[g];
  const isMB = (g) => gname(g) === 'env.__memory_base';
  const isTB = (g) => gname(g) === 'env.__table_base';
  const run = (fi, onInit, onStore) => {
    if (fi === undefined) return;
    let [q, end] = codeBodies[fi - nImported];
    p = q;
    for (let n = u32(); n > 0; n--) { u32(); p++; }
    const st = [];
    const pop = () => st.pop() ?? { u: true };
    const add = (a, b) => {
      if (a.u || b.u) return { u: true };
      const base = a.base && b.base ? 'bad' : (a.base || b.base);
      return { base, c: (a.c || 0) + (b.c || 0) };
    };
    const memarg = () => { const align = u32(); if (align & 0x40) u32(); return u32(); };
    while (p < end) {
      const op = buf[p++];
      if (op === 0x0b || op === 0x01 || op === 0x00 || op === 0x0f) continue;
      if (op === 0x02 || op === 0x03 || op === 0x04) { const bt = buf[p]; if (bt === 0x40 || (bt >= 0x7b && bt <= 0x7f)) p++; else s32(); continue; }
      if (op === 0x0c || op === 0x0d) { u32(); if (op === 0x0d) pop(); continue; }
      if (op === 0x0e) { for (let k = u32(); k > 0; k--) u32(); u32(); pop(); continue; }
      if (op === 0x1a) { pop(); continue; }
      if (op === 0x20) { u32(); st.push({ u: true }); continue; }
      if (op === 0x21) { u32(); pop(); continue; }
      if (op === 0x22) { u32(); continue; }
      if (op === 0x23) { const g = u32(); st.push(isMB(g) ? { base: 'mb', c: 0 } : isTB(g) ? { base: 'tb', c: 0 } : { base: 'got:' + gname(g), c: 0 }); continue; }
      if (op === 0x24) { u32(); pop(); continue; }
      if (op === 0x10) { const f = u32(); for (let k = types[funcTypes[f]]; k > 0; k--) pop(); for (let k = results[funcTypes[f]]; k > 0; k--) st.push({ u: true }); continue; }
      if (op === 0x41) { st.push({ c: s32() }); continue; }
      if (op === 0x42) { s64(); st.push({ u: true }); continue; }
      if (op === 0x6a) { const b = pop(), a = pop(); st.push(add(a, b)); continue; }
      if (op === 0x36) { const off = memarg(); const v = pop(), a = pop(); onStore?.(a, off, v); continue; }
      if (op === 0x37) { memarg(); pop(); pop(); continue; }
      if (op === 0xfc) {
        const sub = u32();
        if (sub === 8) { const seg = u32(); p++; pop(); pop(); const dest = pop(); onInit?.(seg, dest); continue; }
        if (sub === 9) { u32(); continue; }
        if (sub === 11) { p++; pop(); pop(); pop(); continue; }
        throw new Error('0xfc ' + sub);
      }
      if (op === 0xfe) {
        const sub = u32();
        if (sub === 3) { p++; continue; }
        memarg();
        if (sub === 0x00) { pop(); pop(); st.push({ u: true }); continue; }
        if (sub === 0x01 || sub === 0x02) { pop(); pop(); pop(); st.push({ u: true }); continue; }
        if (sub === 0x17 || sub === 0x16) { pop(); pop(); continue; }
        if (sub === 0x10) { pop(); st.push({ u: true }); continue; }
        if (sub === 0x48) { pop(); pop(); pop(); st.push({ u: true }); continue; }
        if (sub >= 0x1e && sub <= 0x47) { pop(); pop(); st.push({ u: true }); continue; }
        throw new Error('0xfe ' + sub.toString(16));
      }
      throw new Error(`op 0x${op.toString(16)} in ${funcNames[fi]}`);
    }
  };
  const place = new Map();
  segs.forEach((s, i) => {
    if (s.off) {
      const g = s.off.find((x) => x.g !== undefined);
      const c = s.off.find((x) => x.c !== undefined);
      if (g && isMB(g.g)) place.set(i, c ? c.c : 0);
    }
  });
  const initFn = exports.__wasm_init_memory ?? funcNames.findIndex((n) => n === '__wasm_init_memory');
  run(initFn >= 0 ? initFn : start, (seg, dest) => { if (dest.base === 'mb') place.set(seg, dest.c); });
  const relocs = new Map();
  run(exports.__wasm_apply_data_relocs, null, (a, off, v) => { if (a.base === 'mb') relocs.set(a.c + off, v); });
  const table = new Map();
  for (const e of elems) {
    const tb = e.off.some((x) => x.g !== undefined && isTB(x.g));
    const c = (e.off.find((x) => x.c !== undefined) || { c: 0 }).c;
    if (tb) e.fns.forEach((f, i) => table.set(c + i, f));
  }
  const mem = (addr) => {
    for (const [i, base] of place) {
      const s = segs[i];
      if (addr >= base && addr + 4 <= base + s.bytes.length) return s.bytes.readUInt32LE(addr - base);
    }
    return undefined;
  };
  const fnAt = (addr) => { const v = relocs.get(addr); return v && v.base === 'tb' ? table.get(v.c) : undefined; };
  const isMem = (addr) => { const v = relocs.get(addr); return v && v.base === 'mb'; };
  const str0 = (addr) => {
    const v = relocs.get(addr);
    if (!v || v.base !== 'mb') return undefined;
    for (const [i, base] of place) {
      const s = segs[i];
      const o = v.c - base;
      if (o >= 0 && o < s.bytes.length) { const e = s.bytes.indexOf(0, o); return s.bytes.toString('latin1', o, e < 0 ? o + 40 : e); }
    }
    return undefined;
  };
  const problems = [];
  let methods = 0, getsets = 0;
  const zero = (a, n) => { for (let k = 0; k < n; k += 4) if (relocs.has(a + k) || mem(a + k) !== 0) return false; return true; };
  const methodAt = (a) => {
    const fn = fnAt(a + 4);
    if (fn === undefined || !isMem(a) || relocs.has(a + 8)) return undefined;
    const flags = mem(a + 8);
    if (flags === undefined || wantParams(flags) === undefined) return undefined;
    if (!(isMem(a + 12) || mem(a + 12) === 0)) return undefined;
    return { fn, flags };
  };
  const getsetAt = (a) => {
    const fn = fnAt(a + 4);
    if (fn === undefined || !isMem(a)) return undefined;
    const setter = fnAt(a + 8);
    if (setter === undefined && (relocs.has(a + 8) || mem(a + 8) !== 0)) return undefined;
    if (!(isMem(a + 12) || mem(a + 12) === 0)) return undefined;
    return { fn, setter };
  };
  const inArray = (a, at, stride) => {
    let e = a;
    while (at(e)) e += stride;
    return zero(e, stride);
  };
  const ident = (a) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(str0(a) ?? '');
  for (const [addr] of relocs) {
    if (!ident(addr)) continue;
    const m = methodAt(addr);
    if (m && inArray(addr, methodAt, 16)) {
      methods++;
      const want = wantParams(m.flags), have = params(m.fn);
      if (have !== want) problems.push({ kind: 'method', name: str0(addr), flags: m.flags, fn: funcNames[m.fn] ?? m.fn, have, want });
      continue;
    }
    const g = getsetAt(addr);
    if (g && inArray(addr, getsetAt, 20)) {
      getsets++;
      if (params(g.fn) !== 2) problems.push({ kind: 'getter', name: str0(addr), fn: funcNames[g.fn] ?? g.fn, have: params(g.fn), want: 2 });
      if (g.setter !== undefined && params(g.setter) !== 3) problems.push({ kind: 'setter', name: str0(addr), fn: funcNames[g.setter] ?? g.setter, have: params(g.setter), want: 3 });
    }
  }
  return { methods, getsets, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let bad = 0;
  for (const f of process.argv.slice(2)) {
    const r = parse(readFileSync(f));
    console.log(`${f}: ${r.methods} method defs, ${r.getsets} getset defs, ${r.problems.length} signature mismatches`);
    for (const x of r.problems) console.log(`  ${x.kind} ${x.name} -> ${x.fn}: ${x.have} params, called with ${x.want}${x.flags !== undefined ? ` (flags 0x${x.flags.toString(16)})` : ''}`);
    bad += r.problems.length;
  }
  process.exit(bad ? 1 : 0);
}
