#!/usr/bin/env node
import { chmodSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ALLOWLIST = join(root, 'scripts/check-no-debug-allowlist.txt');

export function customSections(buf) {
  if (buf.length < 8 || buf.readUInt32LE(0) !== 0x6d736100) return null;
  const out = [];
  let p = 8;
  const leb = () => {
    let r = 0;
    let s = 0;
    let b;
    do {
      b = buf[p++];
      r += (b & 127) * 2 ** s;
      s += 7;
    } while (b & 128 && p < buf.length);
    return r;
  };
  while (p < buf.length) {
    const id = buf[p++];
    const size = leb();
    const end = p + size;
    if (end > buf.length) return out;
    if (id === 0) {
      const n = leb();
      out.push({ name: buf.toString('utf8', p, p + n), size: end - p - n });
    }
    p = end;
  }
  return out;
}

export function arMembers(buf) {
  if (buf.length < 8 || buf.toString('latin1', 0, 8) !== '!<arch>\n') return null;
  const out = [];
  let p = 8;
  let names = null;
  while (p + 60 <= buf.length) {
    let name = buf.toString('latin1', p, p + 16).trim();
    const size = parseInt(buf.toString('latin1', p + 48, p + 58).trim(), 10);
    if (!Number.isFinite(size)) break;
    const data = buf.subarray(p + 60, p + 60 + size);
    if (name === '//') names = data.toString('latin1');
    else if (/^\/\d+$/.test(name) && names) name = names.slice(Number(name.slice(1))).split(/\/?\n/)[0];
    else if (name.startsWith('#1/')) {
      const n = Number(name.slice(3));
      name = data.toString('latin1', 0, n).replace(/\0+$/, '');
      out.push({ name, data: data.subarray(n) });
      p += 60 + size + (size & 1);
      continue;
    }
    if (name !== '/' && name !== '//' && name !== '/SYM64/' && !name.startsWith('__.SYMDEF')) out.push({ name: name.replace(/\/$/, ''), data });
    p += 60 + size + (size & 1);
  }
  return out;
}

export function debugIn(buf) {
  const own = customSections(buf);
  if (own) return own.filter((s) => s.name.startsWith('.debug')).map((s) => ({ member: '', ...s }));
  const members = arMembers(buf);
  if (!members) return [];
  const out = [];
  for (const m of members) {
    const inner = customSections(m.data);
    if (inner) for (const s of inner) if (s.name.startsWith('.debug')) out.push({ member: m.name, ...s });
    if (!inner && arMembers(m.data)) for (const s of debugIn(m.data)) out.push({ ...s, member: `${m.name}(${s.member})` });
  }
  return out;
}

function rawMembers(buf) {
  const out = [];
  let p = 8;
  while (p + 60 <= buf.length) {
    const header = buf.subarray(p, p + 60);
    const size = parseInt(header.toString('latin1', 48, 58).trim(), 10);
    if (!Number.isFinite(size)) throw new Error(`bad archive member header at ${p}`);
    const name = header.toString('latin1', 0, 16).trim();
    const bsd = name.startsWith('#1/') ? Number(name.slice(3)) : 0;
    out.push({ offset: p, header, name, bsd, data: buf.subarray(p + 60, p + 60 + size) });
    p += 60 + size + (size & 1);
  }
  return out;
}

function remapSymbols(m, map) {
  const body = Buffer.from(m.data);
  const at = m.bsd;
  const name = m.bsd ? body.toString('latin1', 0, m.bsd).replace(/\0+$/, '') : m.name;
  const fix = (old) => {
    if (!map.has(old)) throw new Error(`archive symbol table names offset ${old}, which is no member`);
    return map.get(old);
  };
  if (name === '/') {
    const n = body.readUInt32BE(0);
    for (let i = 0; i < n; i++) body.writeUInt32BE(fix(body.readUInt32BE(4 + 4 * i)), 4 + 4 * i);
  } else if (name === '/SYM64/') {
    const n = Number(body.readBigUInt64BE(0));
    for (let i = 0; i < n; i++) body.writeBigUInt64BE(BigInt(fix(Number(body.readBigUInt64BE(8 + 8 * i)))), 8 + 8 * i);
  } else if (name.startsWith('__.SYMDEF')) {
    const len = body.readUInt32LE(at);
    for (let q = at + 4; q < at + 4 + len; q += 8) body.writeUInt32LE(fix(body.readUInt32LE(q + 4)), q + 4);
  }
  return body;
}

export function stripArchive(buf, stripModule) {
  const members = rawMembers(buf);
  const datas = members.map((m) => {
    if (m.name === '/' || m.name === '/SYM64/' || m.name === '//' || (m.bsd && m.data.toString('latin1', 0, m.bsd).startsWith('__.SYMDEF'))) return null;
    const head = m.data.subarray(0, m.bsd);
    const content = m.data.subarray(m.bsd);
    let next = content;
    if (customSections(content)) next = debugIn(content).length ? stripModule(content, m.name) : content;
    else if (arMembers(content)) next = stripArchive(content, stripModule);
    return next === content ? m.data : Buffer.concat([head, next]);
  });
  const map = new Map();
  let p = 8;
  members.forEach((m, i) => {
    map.set(m.offset, p);
    const size = (datas[i] ?? m.data).length;
    p += 60 + size + (size & 1);
  });
  const parts = [buf.subarray(0, 8)];
  members.forEach((m, i) => {
    const data = datas[i] ?? (m.name === '//' ? m.data : remapSymbols(m, map));
    const header = Buffer.from(m.header);
    header.write(String(data.length).padEnd(10), 48, 10, 'latin1');
    parts.push(header, data);
    if (data.length & 1) parts.push(Buffer.from('\n'));
  });
  return Buffer.concat(parts);
}

export function keptSections(buf) {
  const own = customSections(buf);
  const pick = (secs) => secs.map((x) => x.name).filter((n) => !n.startsWith('.debug') && !n.startsWith('reloc..debug'));
  if (own) return pick(own);
  const members = arMembers(buf);
  if (!members) return [];
  return members.flatMap((m) => pick(customSections(m.data) || []).map((n) => `${m.name}:${n}`));
}

export function lostSections(before, after) {
  const left = [...after];
  const lost = [];
  for (const n of before) {
    const i = left.indexOf(n);
    if (i < 0) lost.push(n);
    else left.splice(i, 1);
  }
  return lost;
}

export function scan(dir) {
  const found = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) {
        const hits = debugIn(readFileSync(p));
        if (hits.length) found.push({ file: relative(dir, p), bytes: hits.reduce((a, h) => a + h.size, 0), sections: [...new Set(hits.map((h) => h.name))], members: new Set(hits.map((h) => h.member).filter(Boolean)).size });
      }
    }
  };
  walk(dir);
  return found;
}

export function allowlisted(name, text = readFileSync(ALLOWLIST, 'utf8')) {
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\S+) #(\d+) \S/);
    if (!m) throw new Error(`${ALLOWLIST}:${i + 1}: not "<recipe> #<issue> <reason>": ${line}`);
    if (m[1] === name) return `#${m[2]}`;
  }
  return null;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [name, dir, mode] = process.argv.slice(2);
  if (!name || !dir) {
    console.error('usage: check-no-debug.mjs <recipe> <package dir>');
    process.exit(2);
  }
  const debug = spawnSync(process.execPath, [join(root, 'scripts/read-recipe.mjs'), name, '--field', 'debug'], { encoding: 'utf8' }).stdout.trim();
  if (mode === '--strip') {
    if (allowlisted(name)) {
      console.log(`check-no-debug: PASS ${name}: allowlisted (${allowlisted(name)}), not stripped`);
      process.exit(0);
    }
    const tool = process.env.HOMESCOOP_OBJCOPY || 'llvm-objcopy';
    const work = mkdtempSync(join(tmpdir(), 'check-no-debug-'));
    let n = 0;
    const stripModule = (buf, label) => {
      const a = join(work, `${n}.in`);
      const b = join(work, `${n++}.out`);
      writeFileSync(a, buf);
      const r = spawnSync(tool, ['--strip-debug', a, b], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`${tool} --strip-debug ${label} failed: ${r.error?.message ?? ''}${r.stderr}`);
      const out = readFileSync(b);
      const lost = lostSections(keptSections(buf), keptSections(out));
      if (lost.length) throw new Error(`${tool} --strip-debug ${label} also dropped ${lost.join(', ')}; only .debug_* may go (the name section stays for backtraces)`);
      if (debugIn(out).length) throw new Error(`${tool} --strip-debug ${label} left DWARF`);
      return out;
    };
    let files = [];
    try {
      files = scan(resolve(dir));
      for (const f of files) {
        const p = join(resolve(dir), f.file);
        const buf = readFileSync(p);
        const out = customSections(buf) ? stripModule(buf, f.file) : stripArchive(buf, (b, m) => stripModule(b, `${f.file}(${m})`));
        const mode = statSync(p).mode;
        writeFileSync(p, out);
        chmodSync(p, mode);
        const names = keptSections(out).filter((x) => x === 'name' || x.endsWith(':name')).length;
        console.log(`  stripped ${f.file}: ${f.bytes} bytes of ${f.sections.join(' ')}${names ? `; name section kept (${names})` : ''}`);
      }
    } catch (e) {
      console.error(`check-no-debug: FAIL ${name}: ${e.message}`);
      process.exit(1);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    console.log(`check-no-debug: PASS ${name}: stripped ${files.length} file(s)`);
    process.exit(0);
  }
  const found = scan(resolve(dir));
  const total = found.reduce((a, f) => a + f.bytes, 0);
  for (const f of found) console.log(`  ${f.file}: ${f.bytes} bytes of ${f.sections.join(' ')}${f.members ? ` in ${f.members} member(s)` : ''}`);
  if (!found.length) {
    console.log(`check-no-debug: PASS ${name}: no .debug_* sections in any wasm, archive or object`);
    process.exit(0);
  }
  const issue = allowlisted(name);
  if (debug === 'true' || issue) {
    console.log(`check-no-debug: PASS ${name}: ${found.length} file(s), ${total} bytes of DWARF, allowed (${debug === 'true' ? 'recipe debug: true' : `allowlist ${issue}`})`);
    process.exit(0);
  }
  console.error(`check-no-debug: FAIL ${name}: ${found.length} file(s) ship ${total} bytes of DWARF (homescoop#908). host-run strips it with llvm-objcopy --strip-debug unless the recipe sets debug: true; set debug: true to ship it on purpose, or allowlist it with an issue in scripts/check-no-debug-allowlist.txt`);
  process.exit(1);
}
