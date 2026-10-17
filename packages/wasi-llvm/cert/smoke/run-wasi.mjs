import { readFileSync } from 'node:fs';
import { WASI } from 'node:wasi';

export async function runWasi(wasmPath, { args = [], preopens = {}, env = {} } = {}) {
  const module = await WebAssembly.compile(readFileSync(wasmPath));
  const want = WebAssembly.Module.imports(module);
  const mem = want.find((i) => i.kind === 'memory');
  const memory = new WebAssembly.Memory({ initial: 256, maximum: 65536, shared: true });
  const wasi = new WASI({ version: 'preview1', args: [wasmPath, ...args], env, preopens, returnOnExit: true });
  const imports = { ...wasi.getImportObject() };
  if (mem) imports[mem.module] = { ...(imports[mem.module] || {}), [mem.name]: memory };
  if (want.some((i) => i.module === 'wasi' && i.name === 'thread-spawn')) imports.wasi = { 'thread-spawn': () => -1 };
  const instance = await WebAssembly.instantiate(module, imports);
  const exports = { ...instance.exports };
  if (!exports.memory) exports.memory = memory;
  return { code: wasi.start({ exports }), imports: want };
}
