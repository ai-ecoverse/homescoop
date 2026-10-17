#!/usr/bin/env node
// Per variant, the defined globals of every lib/wasm32-wasip1/*.a and *.o and the include/
// file list of a candidate tarball against a baseline release (homescoop#943):
// anything the candidate drops fails, unless REMOVED below explains it.
//   node packages/wasix-sysroot/test/globals.mjs --tarball <package.tgz> --against <npm spec | tgz>
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { arg, sysroot, wasixcc } from './harness.mjs';

const args = process.argv.slice(2);
if (!arg(args, '--tarball') || !arg(args, '--against')) {
  console.error('usage: globals.mjs --tarball <package.tgz> --against <npm spec | package.tgz>');
  process.exit(2);
}

// Removals that are explained: "<variant>:<archive>:<symbol>" (variant or archive "*"), or "include:<path>".
const REMOVED = {
  '*:libc.a:__musl_sem_shm_mapname': "-14's private rename in sem.c; v2026-07-03.1's sem_open uses shm_open.c's __shm_mapname (-33)",
  // -33's runtimes are upstream libc++ 20.1 (homescoop#935): the C++ libraries' symbols are not compared.
};
const CXX = /^lib(c\+\+|c\+\+abi|c\+\+experimental|unwind)\.a$/;

const work = mkdtempSync(join(tmpdir(), 'sysroot-globals-'));
try {
  const env = wasixcc(work);
  const nm = join(env.WASIXCC_LLVM_LOCATION, 'bin/llvm-nm');
  const cand = sysroot(arg(args, '--tarball'), join(work, 'cand'));
  const base = sysroot(arg(args, '--against'), join(work, 'base'));
  // llvm-nm exits 1 for an archive or object without symbols (libm.a's placeholder): its output still counts.
  // A linker stub list (libcommon-tag-stubs.a is "#STUB" and symbol names, not an archive): its names.
  const defined = (file) => {
    const head = readFileSync(file).subarray(0, 5).toString();
    if (head === '#STUB') return new Set(readFileSync(file, 'utf8').split('\n').slice(1).filter(Boolean));
    const r = spawnSync(nm, ['--defined-only', '--extern-only', '-j', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0 && !/no symbols/i.test(r.stderr || '') && !(r.stdout || '').trim()) throw new Error(`${nm} ${file}: ${r.stderr}`);
    return new Set((r.stdout || '').split('\n').filter((l) => l && !l.endsWith(':')));
  };
  const files = (dir) => {
    const out = [];
    const walk = (d) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else out.push(relative(dir, p));
      }
    };
    walk(dir);
    return new Set(out);
  };
  const lost = [];
  let compared = 0;
  for (const v of readdirSync(base).filter((d) => d.startsWith('sysroot'))) {
    const lib = (p) => join(p, v, 'lib/wasm32-wasip1');
    for (const a of readdirSync(lib(base)).filter((f) => /\.(a|o)$/.test(f) && !CXX.test(f))) {
      const was = defined(join(lib(base), a));
      if (!existsSync(join(lib(cand), a))) {
        lost.push(`${v}: ${a} is gone`);
        continue;
      }
      const now = defined(join(lib(cand), a));
      compared++;
      for (const s of was) {
        if (now.has(s) || REMOVED[`${v}:${a}:${s}`] || REMOVED[`*:${a}:${s}`] || REMOVED[`${v}:*:${s}`]) continue;
        lost.push(`${v}: ${a} no longer defines ${s}`);
      }
    }
    const inc = files(join(cand, v, 'include'));
    for (const f of files(join(base, v, 'include'))) {
      if (f.startsWith('c++/')) continue;
      if (!inc.has(f) && !REMOVED[`include:${f}`]) lost.push(`${v}: include/${f} is gone`);
    }
  }
  assert.deepEqual(lost, [], `removed against ${arg(args, '--against')}:\n${lost.join('\n')}`);
  console.log(`PASS test/globals.mjs: ${compared} archives and objects in ${readdirSync(base).filter((d) => d.startsWith('sysroot')).length} variants keep every defined global of ${arg(args, '--against')} (C++ runtimes aside, #935), and every non-C++ header`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
