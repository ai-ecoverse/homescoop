// node mismatch.mjs <file.so>...: wasm-ld's signature_mismatch stubs (each traps when called); exit 1 if any.
import fs from 'node:fs';
let total = 0;
for (const f of process.argv.slice(2)) {
  const m = new WebAssembly.Module(fs.readFileSync(f));
  const names = WebAssembly.Module.customSections(m, 'name').map((s) => Buffer.from(s).toString('latin1')).join('');
  const hits = [...new Set(names.match(/signature_mismatch:[A-Za-z0-9_]+/g) ?? [])];
  if (hits.length) console.log(`${f.split('/').pop()}: ${hits.length} ${hits.map((h) => h.slice(19)).sort().join(' ')}`);
  total += hits.length;
}
console.log(`${total} signature_mismatch stubs`);
process.exit(total ? 1 : 0);
