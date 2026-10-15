#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
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

let bad = 0;
let shimmed = 0;
for (const p of wasms) {
  let mod;
  try {
    mod = new WebAssembly.Module(readFileSync(p));
  } catch {
    continue;
  }
  const exports = new Set(WebAssembly.Module.exports(mod).map((e) => e.name));
  if (!exports.has('slicc_sig_mask')) continue;
  shimmed++;
  const imports = new Set(WebAssembly.Module.imports(mod).map((i) => i.name));
  const missing = [];
  if (!imports.has('slicc_cred_js')) missing.push('import slicc_cred_js');
  if (!exports.has('slicc_cred_euid')) missing.push('export slicc_cred_euid');
  if (missing.length) {
    bad++;
    console.error(`homescoop: ${relative(dir, p)} links the slicc shims without their credentials (${missing.join(', ')}): getuid() would not be the kernel's`);
  }
}
console.log(`  check-slicc-cred: ${shimmed} of ${wasms.length} wasm link the slicc shims${bad ? `, ${bad} without credentials` : ', all with credentials'}`);
process.exit(bad ? 1 : 0);
