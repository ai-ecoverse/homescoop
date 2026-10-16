import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { instantiate } from './index.js';

export { instantiate } from './index.js';

export const wasmPath = fileURLToPath(new URL('./dist/webrtc-audio-processing.wasm', import.meta.url));

let module = null;

export function wasmModule() {
  if (!module) module = new WebAssembly.Module(readFileSync(wasmPath));
  return module;
}

export function create(options) {
  return instantiate(wasmModule(), options).create(options);
}
