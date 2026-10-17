#!/usr/bin/env node
// Reject wasm that SLICC cannot instantiate or whose shared memory cannot grow.
import { readFileSync } from 'node:fs';

const bytes = readFileSync(process.argv[2]);
const module = new WebAssembly.Module(bytes);
const unexpected = WebAssembly.Module.imports(module).filter(
  (entry) => entry.module === 'env' && entry.name !== 'memory'
);
if (unexpected.length) throw new Error(`unexpected env imports: ${JSON.stringify(unexpected)}`);

let at = 8;
const u32 = () => {
  let value = 0;
  let shift = 0;
  let byte;
  do {
    byte = bytes[at++];
    value |= (byte & 127) << shift;
    shift += 7;
  } while (byte & 128);
  return value >>> 0;
};
const name = () => {
  const size = u32();
  const value = bytes.toString('utf8', at, at + size);
  at += size;
  return value;
};
let memory;
while (at < bytes.length) {
  const section = bytes[at++];
  const size = u32();
  const end = at + size;
  if (section === 2) {
    for (let count = u32(); count > 0; count--) {
      const namespace = name();
      const field = name();
      const kind = bytes[at++];
      if (kind === 0) u32();
      else if (kind === 2) {
        const flags = u32();
        const initial = u32();
        const maximum = flags & 1 ? u32() : undefined;
        if (namespace === 'env' && field === 'memory')
          memory = { initial, maximum, shared: Boolean(flags & 2) };
      } else throw new Error(`unsupported import kind ${kind}`);
    }
    break;
  }
  at = end;
}
if (!memory?.shared || memory.maximum < 1024)
  throw new Error(`Cargo needs growable shared memory: ${JSON.stringify(memory)}`);
console.log(`Cargo shared memory: ${memory.initial}..${memory.maximum} pages`);
