export type WasmSource = WebAssembly.Module | ArrayBuffer | ArrayBufferView;

export type NoiseSuppressionLevel = 'low' | 'moderate' | 'high' | 'veryHigh';

export interface CancellerOptions {
  /** APM's processing rate; mic and reference must already be at this rate. */
  sampleRate: 16000 | 48000;
  /** WebRTC's noise suppressor on the capture path; true is 'moderate'. Adds 6 ms of latency. */
  noiseSuppression?: boolean | NoiseSuppressionLevel;
  /** WebRTC's GMM voice activity detector on the cancelled output; true is aggressiveness 1. */
  vad?: boolean | 0 | 1 | 2 | 3;
}

export interface InstanceOptions {
  /** Receives each line the wasm writes to stdout or stderr. */
  log?: (line: string) => void;
}

export interface CancellerStats {
  /** AEC3's estimate of the delay from reference to mic, in 4 ms steps; null until it has one. */
  delayMs: number | null;
  /** AEC3's echo return loss enhancement (ERLE) in dB; null until it has one. */
  erleDb: number | null;
  /** AEC3's echo return loss (ERL) in dB; null until it has one. */
  erlDb: number | null;
  divergentFilterFraction: number | null;
  delayMedianMs: number | null;
  /** The VAD's verdict on the last 10 ms frame of output; null without vad. */
  voice: boolean | null;
  /** Reference samples dropped because more than a second was queued ahead of the mic. */
  referenceDropped: number;
  /** Reference samples that were missing when a mic frame was processed (replaced by silence). */
  referenceShort: number;
  /** NaN and ±Infinity samples in mic or reference, each replaced by 0 before APM sees it. */
  nonFiniteSamples: number;
  /** Frames APM returned an error for. */
  errors: number;
}

export interface EchoCanceller {
  readonly sampleRate: 16000 | 48000;
  /** APM's frame: 10 ms (160 or 480 samples). */
  readonly frameSize: number;
  /** End-to-end delay of cancel()'s output behind its input, in samples. */
  readonly latencySamples: number;
  /**
   * Cancels the reference's echo from mic. Mono, any length; the result is
   * as long as mic and lags it by latencySamples. Pass out to reuse a buffer
   * (it may be mic itself).
   */
  cancel(mic: Float32Array, reference: Float32Array, out?: Float32Array): Float32Array;
  stats(): CancellerStats;
  /** Frees the canceller's APM; further calls throw. */
  destroy(): void;
}

export interface WebRtcAudioProcessing {
  create(options: CancellerOptions): EchoCanceller;
  /** The instance's linear memory, shared by every canceller made on it. */
  readonly memory: WebAssembly.Memory;
}

/** Instantiates the wasm synchronously (no fetch, no top-level await): usable in an AudioWorkletGlobalScope. */
export function instantiate(wasm: WasmSource, options?: InstanceOptions): WebRtcAudioProcessing;

/** instantiate(options.wasm, options).create(options). */
export function create(options: CancellerOptions & InstanceOptions & { wasm: WasmSource }): EchoCanceller;
