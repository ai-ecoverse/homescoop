#!/usr/bin/env node
import { chmodSync, readFileSync, readdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  for (const m of members) for (const s of customSections(m.data) || []) if (s.name.startsWith('.debug')) out.push({ member: m.name, ...s });
  return out;
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [name, dir, mode] = process.argv.slice(2);
  if (!name || !dir) {
    console.error('usage: check-no-debug.mjs <recipe> <package dir>');
    process.exit(2);
  }
  const debug = spawnSync(process.execPath, [join(root, 'scripts/read-recipe.mjs'), name, '--field', 'debug'], { encoding: 'utf8' }).stdout.trim();
  if (mode === '--strip') {
    if (allowlisted(name)) {
      console.log(`check-no-debug: ${name}: allowlisted (${allowlisted(name)}), not stripped`);
      process.exit(0);
    }
    const tool = process.env.HOMESCOOP_OBJCOPY || 'llvm-objcopy';
    for (const f of scan(resolve(dir))) {
      const p = join(resolve(dir), f.file);
      const tmp = `${p}.nodebug`;
      const r = spawnSync(tool, ['--strip-debug', p, tmp], { encoding: 'utf8' });
      if (r.status !== 0) {
        console.error(`check-no-debug: ${tool} --strip-debug ${f.file} failed: ${r.error?.message ?? ''}${r.stderr}`);
        process.exit(1);
      }
      const mode = statSync(p).mode;
      renameSync(tmp, p);
      chmodSync(p, mode);
      console.log(`  stripped ${f.file}: ${f.bytes} bytes of ${f.sections.join(' ')}`);
    }
    process.exit(0);
  }
  const found = scan(resolve(dir));
  const total = found.reduce((a, f) => a + f.bytes, 0);
  for (const f of found) console.log(`  ${f.file}: ${f.bytes} bytes of ${f.sections.join(' ')}${f.members ? ` in ${f.members} member(s)` : ''}`);
  if (!found.length) {
    console.log(`check-no-debug: ${name}: no .debug_* sections in any wasm, archive or object`);
    process.exit(0);
  }
  const issue = allowlisted(name);
  if (debug === 'true' || issue) {
    console.log(`check-no-debug: ${name}: ${found.length} file(s), ${total} bytes of DWARF, allowed (${debug === 'true' ? 'recipe debug: true' : `allowlist ${issue}`})`);
    process.exit(0);
  }
  console.error(`check-no-debug: ${name}: ${found.length} file(s) ship ${total} bytes of DWARF (homescoop#908). host-run strips it with llvm-objcopy --strip-debug unless the recipe sets debug: true; set debug: true to ship it on purpose, or allowlist it with an issue in scripts/check-no-debug-allowlist.txt`);
  process.exit(1);
}
