import type { CancellerOptions, EchoCanceller, InstanceOptions } from './index.js';

export { instantiate } from './index.js';
export type * from './index.js';

/** The absolute path of dist/webrtc-audio-processing.wasm. */
export const wasmPath: string;

/** The compiled wasm, read and compiled once. */
export function wasmModule(): WebAssembly.Module;

/** A canceller on its own instance of the wasm. */
export function create(options: CancellerOptions & InstanceOptions): EchoCanceller;
