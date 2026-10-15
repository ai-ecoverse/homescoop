#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: check-slicc-cred.mjs <package dir>');
  process.exit(2);
}

const wasms = [];
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (e.endsWith('.wasm')) wasms.push(p);
  }
};
walk(dir);

const surface = (p) => {
  try {
    const mod = new WebAssembly.Module(readFileSync(p));
    return {
      imports: new Set(WebAssembly.Module.imports(mod).map((i) => i.name)),
      exports: new Set(WebAssembly.Module.exports(mod).map((e) => e.name)),
    };
  } catch {
    return undefined;
  }
};
const lacks = (s) => [
  ...(s.imports.has('slicc_cred_js') ? [] : ['import slicc_cred_js']),
  ...(s.exports.has('slicc_cred_euid') ? [] : ['export slicc_cred_euid']),
];

let bad = 0;
let shimmed = 0;
for (const p of wasms) {
  const s = surface(p);
  if (!s || !s.exports.has('slicc_sig_mask')) continue;
  shimmed++;
  const missing = lacks(s);
  if (missing.length) {
    bad++;
    console.error(`homescoop: ${relative(dir, p)} links the slicc shims without their credentials (${missing.join(', ')}): getuid() would not be the kernel's`);
  }
}

const pkgFile = join(dir, 'package.json');
const pkg = existsSync(pkgFile) ? JSON.parse(readFileSync(pkgFile, 'utf8')) : {};
const clean = (v) => v.replace(/^\$\{package\}\//, '').replace(/^\.\//, '');
const commandWasms = new Set();
const commandGlues = new Set();
if (pkg.slicc?.abi === 'emscripten') {
  for (const c of Object.values(pkg.slicc.commands ?? {})) {
    if (typeof c?.wasm === 'string' && c.wasm) commandWasms.add(clean(c.wasm));
    if (typeof c?.glue === 'string' && c.glue) commandGlues.add(clean(c.glue));
  }
}
for (const rel of [...commandWasms].sort()) {
  const s = surface(join(dir, rel));
  if (!s) {
    bad++;
    console.error(`homescoop: ${rel} (an Emscripten command) is not a readable wasm module`);
    continue;
  }
  const missing = lacks(s);
  if (missing.length) {
    bad++;
    console.error(`homescoop: ${rel} (an Emscripten command) lacks the slicc credential library (${missing.join(', ')}): slicc-kernel shows every file as 1000:1000 under users (homescoop#459)`);
  }
}
for (const rel of [...commandGlues].sort()) {
  const file = join(dir, rel);
  if (existsSync(file) && !readFileSync(file, 'latin1').includes('slicc_cred_js')) {
    bad++;
    console.error(`homescoop: ${rel} (Emscripten glue) does not name slicc_cred_js (homescoop#459)`);
  }
}
console.log(`  check-slicc-cred: ${shimmed} of ${wasms.length} wasm link the slicc shims; ${commandWasms.size} Emscripten command wasm${bad ? `; ${bad} problem(s)` : ', all with credentials'}`);
process.exit(bad ? 1 : 0);
