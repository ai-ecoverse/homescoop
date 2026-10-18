// node unresolved.mjs <main.wasm> <side.so>...: env imports of side modules not exported by main nor defined by any side module.
import fs from 'node:fs';
const [main, ...sides] = process.argv.slice(2);
const exp = new Set(WebAssembly.Module.exports(new WebAssembly.Module(fs.readFileSync(main))).map((e) => e.name));
const mods = sides.map((f) => ({ f, m: new WebAssembly.Module(fs.readFileSync(f)) }));
for (const { m } of mods) for (const e of WebAssembly.Module.exports(m)) exp.add(e.name);
const miss = new Map();
for (const { f, m } of mods)
  for (const i of WebAssembly.Module.imports(m))
    if (i.module === 'env' && i.kind === 'function' && !exp.has(i.name)) (miss.get(i.name) ?? miss.set(i.name, []).get(i.name)).push(f.split('/').pop());
for (const [n, fs2] of [...miss].sort()) console.log(n, '<-', [...new Set(fs2)].join(' '));
console.log(miss.size, 'unresolved');
