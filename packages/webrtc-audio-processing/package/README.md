# @ai-ecoverse/wasm-webrtc-audio-processing

WebRTC's **AEC3** echo canceller, from freedesktop's
[webrtc-audio-processing](https://gitlab.freedesktop.org/pulseaudio/webrtc-audio-processing)
2.1 (WebRTC's AudioProcessing module, BSD-3-Clause, with abseil-cpp,
Apache-2.0), compiled from source with Emscripten to one standalone
`dist/webrtc-audio-processing.wasm`, plus a small hand-written JS wrapper.
Built for [pi-audio](https://github.com/ai-ecoverse/pi-audio)'s `wasm` echo
mode.

The wrapper instantiates the wasm **synchronously** from a
`WebAssembly.Module` or its bytes: no `fetch`, no `importScripts`, no
top-level await. So it runs inside an **AudioWorkletGlobalScope**, and the
same code runs in Node.

## Use

In an AudioWorklet, compile the wasm on the main thread and hand the module
to the processor:

```js
const module = await WebAssembly.compileStreaming(fetch(wasmUrl));
new AudioWorkletNode(context, 'aec', { processorOptions: { module } });
```

```js
import { instantiate } from '@ai-ecoverse/wasm-webrtc-audio-processing';

registerProcessor('aec', class extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.aec = instantiate(options.processorOptions.module).create({ sampleRate });
  }
  process([[mic, reference]], [[out]]) {
    this.aec.cancel(mic, reference, out);
    return true;
  }
});
```

In Node:

```js
import { create } from '@ai-ecoverse/wasm-webrtc-audio-processing/node';

const aec = create({ sampleRate: 48000, noiseSuppression: true, vad: true });
const cleaned = aec.cancel(mic, reference);
const { delayMs, erleDb } = aec.stats();
aec.destroy();
```

`instantiate(wasm)` makes one wasm instance; each `create()` on it is an
independent canceller. `create({ wasm, sampleRate })` does both in one call.

## API

`create({ sampleRate, noiseSuppression?, vad? })`:

- `sampleRate`: `16000` or `48000`. Resample before, if needed.
- `noiseSuppression`: `true` (`'moderate'`), `'low'`, `'high'` or
  `'veryHigh'`. Off by default.
- `vad`: `true`, or an aggressiveness from 0 to 3. WebRTC's GMM voice
  activity detector, run on the cancelled output; `stats().voice` is its
  verdict on the last 10 ms frame.

The canceller:

- `cancel(mic, reference, out?)`: mono `Float32Array`s of any length (128
  sample render quanta work). Returns the cancelled mic, as long as `mic`.
  `out` reuses a buffer, and may be `mic` itself. The reference is queued, so
  mic and reference chunks needn't line up; up to one second of reference
  is kept ahead of the mic (`stats().referenceDropped` counts the rest), and
  a mic frame with no reference gets silence (`referenceShort`).
- `stats()`: `{ delayMs, erleDb, erlDb, divergentFilterFraction,
  delayMedianMs, voice, referenceDropped, referenceShort, errors }`.
  `delayMs` and `erleDb` come from APM's `GetStatistics()`: AEC3's delay
  estimate from reference to mic (in 4 ms steps) and its echo return loss
  enhancement. Each is `null` until AEC3 has one.
- `destroy()`: frees the canceller.

The high-pass filter is on (AEC3 enforces it), so content below about 80 Hz
is removed. Gain control is off.

## Latency

APM works on 10 ms frames, so `cancel()` buffers internally. Its output lags
its input by a fixed `latencySamples`, whatever the chunk sizes:

| | 16 kHz | 48 kHz |
| --- | --- | --- |
| without noise suppression | 288 samples (18.0 ms) | 910 samples (19.0 ms) |
| with noise suppression | 384 samples (24.0 ms) | 1198 samples (25.0 ms) |

That is 10 ms of framing in the wrapper, 8 ms of AEC3's 4 ms block framing,
about 1 ms of band splitting at 48 kHz, and 6 ms for the noise suppressor.

## Licences

`LICENSE` holds webrtc-audio-processing's BSD-3-Clause licence and abseil's
Apache-2.0 licence. `THIRD-PARTY-NOTICES.md` has every licence the wasm
links: WebRTC's own and its patent grant, abseil-cpp, rnnoise, pffft, Ooura's
FFT, spl_sqrt_floor, fft, and Emscripten's runtime. The wrapper (`index.js`,
`node.js`) and the C ABI it drives are homescoop's, Apache-2.0.

Types: `index.d.ts`, `node.d.ts`. Build: `packages/webrtc-audio-processing/build.sh`
in [homescoop](https://github.com/ai-ecoverse/homescoop).
