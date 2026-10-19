#!/usr/bin/env node
// threaded-heap guard (homescoop#1287, slicc-kernel#1172).
//
// In threaded wasm (a shared memory) with bulk memory (memory.fill /
// memory.copy, 0xFC 0x0B / 0xFC 0x0A), V8 can trap "memory access out of
// bounds" right after another thread grew the memory: a thread's cached
// memory length is refreshed lazily, and an inlined fill in a fresh block
// is checked against the stale one. The mitigation lives in the build: an
// allocator refresh (memory.grow(0) when a block ends above memory.size) and
// an initial heap sized from the measured peak, recorded in recipe.yaml:
//
//   wasm:
//     initial-memory: 256MiB
//     measured-peak: 232MiB
//     measured-by: "<run or command>"
//
// For each .wasm in a package (a tarball or a directory), a main module with
// a shared memory and bulk-memory opcodes needs those fields (a side module,
// one with a dylink.0 section, runs in its host program's memory and heap), and its linked
// initial memory must be the recorded one. Packages not yet sized are listed
// in scripts/threaded-heap-allowlist.txt ("<recipe> #<issue> <reason>"); an
// entry for a package that no longer needs it is stale and fails.
//
//   node scripts/check-threaded-heap.mjs <recipe> <package.tgz | package dir>
import { execFileSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ALLOWLIST = join(root, 'scripts/threaded-heap-allowlist.txt');
const PAGE = 65536;

/** The memory a module imports or defines, and how many bulk-memory opcodes its code has. */
export function inspect(buf) {
  if (buf.length < 8 || buf.readUInt32LE(0) !== 0x6d736100) return null;
  let p = 8;
  const u32 = () => {
    let r = 0;
    let s = 0;
    let b;
    do {
      b = buf[p++];
      r += (b & 0x7f) * 2 ** s;
      s += 7;
    } while (b & 0x80);
    return r;
  };
  const name = () => {
    const n = u32();
    const s = buf.toString('utf8', p, p + n);
    p += n;
    return s;
  };
  const limits = () => {
    const flags = buf[p++];
    const initial = u32();
    const max = flags & 1 ? u32() : null;
    return { shared: (flags & 2) !== 0, memory64: (flags & 4) !== 0, initial, max };
  };
  let memory = null;
  let fills = 0;
  let copies = 0;
  let side = false;
  while (p < buf.length) {
    const id = buf[p++];
    const size = u32();
    const end = p + size;
    if (id === 0) {
      const n = name();
      if (n === 'dylink.0' || n === 'dylink') side = true;
    } else if (id === 2) {
      const n = u32();
      for (let i = 0; i < n && !memory; i++) {
        name();
        name();
        const kind = buf[p++];
        if (kind === 0) u32();
        else if (kind === 1) {
          p++;
          limits();
        } else if (kind === 2) memory = { imported: true, ...limits() };
        else if (kind === 3) p += 2;
        else if (kind === 4) {
          p++;
          u32();
        } else break;
      }
    } else if (id === 5 && !memory) {
      if (u32() > 0) memory = { imported: false, ...limits() };
    } else if (id === 10) {
      for (let i = p; i < end - 1; i++) {
        if (buf[i] !== 0xfc) continue;
        if (buf[i + 1] === 0x0b) fills++;
        else if (buf[i + 1] === 0x0a) copies++;
      }
    }
    p = end;
  }
  return { memory, fills, copies, side };
}

export function bytes(size) {
  const m = /^(\d+)\s*(B|KiB|MiB|GiB)?$/.exec(String(size ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 }[m[2] || 'B'];
}

export function allowlisted(name, text = readFileSync(ALLOWLIST, 'utf8')) {
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const m = /^(\S+)\s+(#\d+)\s+\S/.exec(l);
    if (!m) throw new Error(`scripts/threaded-heap-allowlist.txt: "${l}" is not "<recipe> #<issue> <reason>"`);
    if (m[1] === name) return m[2];
  }
  return null;
}

/** The recipe's wasm: fields, or problems with them. */
export function heapFields(wasm) {
  if (wasm === undefined || wasm === null) return { fields: null, problems: [] };
  const problems = [];
  const initial = bytes(wasm['initial-memory']);
  const peak = bytes(wasm['measured-peak']);
  if (initial === null) problems.push(`wasm.initial-memory ${JSON.stringify(wasm['initial-memory'] ?? null)} is not a size like 256MiB`);
  else if (initial % PAGE) problems.push(`wasm.initial-memory ${wasm['initial-memory']} is not a whole number of 64 KiB pages`);
  if (peak === null) problems.push(`wasm.measured-peak ${JSON.stringify(wasm['measured-peak'] ?? null)} is not a size like 232MiB`);
  if (initial !== null && peak !== null && peak > initial) problems.push(`wasm.measured-peak ${wasm['measured-peak']} is above wasm.initial-memory ${wasm['initial-memory']}`);
  if (typeof wasm['measured-by'] !== 'string' || !wasm['measured-by'].trim()) problems.push('wasm.measured-by names no run or command');
  return { fields: { initial, peak }, problems };
}

/** Pure: the verdict for one package, given its recipe's wasm field, the allowlist entry and its modules. */
export function verdict(name, wasm, entry, modules) {
  const threaded = modules.filter((m) => !m.side && m.memory?.shared && m.fills + m.copies > 0);
  const { fields, problems } = heapFields(wasm);
  const out = [];
  if (fields) {
    out.push(...problems);
    for (const m of threaded) {
      const linked = m.memory.initial * PAGE;
      if (fields.initial !== null && linked !== fields.initial) {
        out.push(`${m.file}: links an initial memory of ${linked / 1024 ** 2} MiB, not wasm.initial-memory ${wasm['initial-memory']}`);
      }
    }
    if (entry) out.push(`scripts/threaded-heap-allowlist.txt lists ${name} (${entry}), but its recipe has wasm.initial-memory: drop the line`);
  } else if (threaded.length && !entry) {
    out.push(
      `${threaded.map((m) => `${m.file} (shared memory, ${m.fills} memory.fill + ${m.copies} memory.copy)`).join(', ')}: a threaded bulk-memory module needs wasm: { initial-memory, measured-peak, measured-by } in recipe.yaml (homescoop#1287)`,
    );
  } else if (!threaded.length && entry) {
    out.push(`scripts/threaded-heap-allowlist.txt lists ${name} (${entry}), but no module of it has a shared memory with bulk-memory opcodes: drop the line`);
  }
  return { threaded, problems: out };
}

function wasmFiles(dir) {
  const found = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && st.size >= 8) {
        const head = Buffer.alloc(4);
        const fd = openSync(p, 'r');
        readSync(fd, head, 0, 4, 0);
        closeSync(fd);
        if (head.readUInt32LE(0) === 0x6d736100) found.push(p);
      }
    }
  };
  walk(dir);
  return found;
}

function main(argv) {
  const [name, target] = argv;
  if (!name || !target) {
    console.error('usage: check-threaded-heap.mjs <recipe> <package.tgz | package dir>');
    return 2;
  }
  let dir = resolve(target);
  let work = null;
  try {
    if (statSync(dir).isFile()) {
      work = mkdtempSync(join(tmpdir(), 'threaded-heap-'));
      execFileSync('tar', ['-xzf', dir, '-C', work]);
      dir = join(work, 'package');
    }
    const recipe = JSON.parse(execFileSync(process.execPath, [join(root, 'scripts/read-recipe.mjs'), name, '--json'], { encoding: 'utf8' }));
    const modules = wasmFiles(dir).map((p) => ({ file: relative(dir, p), ...inspect(readFileSync(p)) }));
    const { threaded, problems } = verdict(name, recipe.wasm, allowlisted(name), modules);
    if (problems.length) {
      for (const pr of problems) console.error(`  ${pr}`);
      console.log(`threaded-heap: FAIL ${name}: ${problems.length} problem(s)`);
      return 1;
    }
    const why = !threaded.length
      ? `no threaded bulk-memory module in ${modules.length} wasm file(s)`
      : recipe.wasm
        ? `${threaded.length} threaded bulk-memory module(s), initial memory ${recipe.wasm['initial-memory']} (measured peak ${recipe.wasm['measured-peak']})`
        : `${threaded.length} threaded bulk-memory module(s), allowlisted (${allowlisted(name)})`;
    console.log(`threaded-heap: PASS ${name}: ${why}`);
    return 0;
  } catch (e) {
    console.log(`threaded-heap: FAIL ${name}: ${e.message}`);
    return 1;
  } finally {
    if (work) rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
