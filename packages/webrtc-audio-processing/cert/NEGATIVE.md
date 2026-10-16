# Negative proof (webrtc-audio-processing)

## 2.1.0-2: non-finite input (#744)

**Date:** 2026-10-16. The case `NaN and Infinity in mic and reference
become 0 and are counted; the output stays finite and ERLE recovers` in
`lib/node.mjs` (both rates, with and without noise suppression), and its
counterpart in `worklet.mjs`. The signal is the 80 ms echo scene. Into it
go 64 NaN mic samples at 6 s, 10 NaN reference samples from 6.5 s,
+Infinity in the mic at 7 s and -Infinity in the reference at 7.2 s: 76
in all. The output must have no non-finite sample, `nonFiniteSamples` must
be exactly 76, and ERLE must be >= 20 dB from 9 s on.

**The published 2.1.0-1** (npm tarball sha256
`89eb9dd3c2cfe198f95c32e9926a2b0c6e4a0496741a278395527ebfe84b121f`) fails
the new case, and only it. From the first NaN on, every output sample is
NaN:

```
16000 Hz non-finite input: {"nonFiniteOut":95776,"erleBeforeDb":null,"erleAfterDb":null}
48000 Hz non-finite input: {"nonFiniteOut":287328,"erleBeforeDb":null,"erleAfterDb":null}
✖ NaN and Infinity in mic and reference become 0 and are counted; … AssertionError: 95776 non-finite output samples
✖ NaN and Infinity in mic and reference become 0 and are counted; … AssertionError: 287328 non-finite output samples
ℹ tests 18  ℹ pass 16  ℹ fail 2
browser-cert: FAIL packages/webrtc-audio-processing/cert/worklet.mjs
AssertionError [ERR_ASSERTION]: 16000 Hz: 95776 non-finite output samples after NaN/Infinity input (#744)
```

**2.1.0-2** passes (local `host-run.sh` build, tarball sha256
`da6cd0ccf605bbb9feaf4a0341affc28108fbf0096aa0b256dc2915dbd8acad6`):

```
16000 Hz non-finite input: {"nonFiniteOut":0,"erleBeforeDb":28.3,"erleAfterDb":32.1,"nonFiniteSamples":76}
16000 Hz non-finite input (ns): {"nonFiniteOut":0,"erleBeforeDb":40.2,"erleAfterDb":44.1,"nonFiniteSamples":76}
48000 Hz non-finite input: {"nonFiniteOut":0,"erleBeforeDb":29.9,"erleAfterDb":33.7,"nonFiniteSamples":76}
48000 Hz non-finite input (ns): {"nonFiniteOut":0,"erleBeforeDb":41.2,"erleAfterDb":45.0,"nonFiniteSamples":76}
ℹ tests 18  ℹ pass 18  ℹ fail 0
worklet 16000 Hz: … "poison":{"nonFiniteOut":0,"erleBeforeDb":28.3,"erleAfterDb":32.1,"count":76,"nonFiniteSamples":76}
worklet 48000 Hz: … "poison":{"nonFiniteOut":0,"erleBeforeDb":29.9,"erleAfterDb":33.7,"count":76,"nonFiniteSamples":76}
browser-cert: ok packages/webrtc-audio-processing/cert/worklet.mjs
```

The case also checks that `cancel()` leaves the caller's arrays alone (a
frame of NaN stays NaN in the caller's buffer). Everything below is the
2.1.0-1 proof, which still holds.

## 2.1.0-1

**Date:** 2026-10-16. The first `cert/` of a new package. Run locally on
macOS arm64 against a `host-run.sh` build of 2.1.0-1 (emsdk 4.0.23),
tarball sha256 `72e37b1f013a2598325fc63a0985e21e0e8acfc2e75e2cee39ee6f56330b3528`,
with slicc-kernel 1.102.6 (the root `package.json` pin) and the harness's
Chromium (playwright-core 1.64.0) for `worklet.mjs`. Two builds in different
`HOMESCOOP_WORK` directories gave that same sha256.

`worklet.mjs` is the browser spec (the tarball's `index.js` inside an
`AudioWorkletGlobalScope`, in an `OfflineAudioContext`); `lib/node.mjs` is
the `ci:` command (`node --test`).

### The build under test passes

```
worklet 16000 Hz: … "latency":288 … "stats":{"delayMs":76,"erleDb":27.6,…} "echo":{"erleDb":30.67,…} "talk":{"nearGain":0.739,"nearCorr":0.772,"erleBeforeDb":42.2,…}
worklet 48000 Hz: … "latency":910 … "stats":{"delayMs":76,"erleDb":32.3,…} "echo":{"erleDb":32.32,…} "talk":{"nearGain":0.734,"nearCorr":0.816,"erleBeforeDb":43.3,…}
browser-cert: ok packages/webrtc-audio-processing/cert/worklet.mjs
16000 Hz: ERLE 30.7 dB (first 2 s 30.5 dB), stats {"delayMs":76,"erleDb":27.26,…}, 89.8x realtime
48000 Hz: ERLE 32.3 dB (first 2 s 30.5 dB), stats {"delayMs":76,"erleDb":31.97,…}, 81.1x realtime
ℹ tests 16  ℹ pass 16  ℹ fail 0
```

The thresholds sit well below what AEC3 does here: ERLE ≥ 20 dB (measured
30.7 and 32.3), AEC3's own `erleDb` ≥ 10 (27.3 and 32.0), the delay within
12 ms (76 for an 80 ms echo; 36, 76, 156 and 296 for 40, 80, 160 and 300),
the near end kept in double talk with gain ≥ 0.5 and correlation ≥ 0.6
(0.74 and 0.77 to 0.82).

### The published 0.0.0

The name's placeholder (README and package.json only) has no `index.js`:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/package/index.js'
ℹ tests 16  ℹ pass 0  ℹ cancelled 16          (exit 1)
browser-cert: FAIL packages/webrtc-audio-processing/cert/worklet.mjs
Error: TypeError: Failed to fetch dynamically imported module: …/node_modules/@ai-ecoverse/wasm-webrtc-audio-processing/index.js
```

### Known-bad builds of 2.1.0-1

Each is the tarball under test with `dist/webrtc-audio-processing.wasm`
replaced, and the same `index.js`.

**Empty wasm** (0 bytes):

```
browser-cert: FAIL packages/webrtc-audio-processing/cert/worklet.mjs
Error: CompileError: WebAssembly.compile(): BufferSource argument is empty
CompileError: WebAssembly.Module(): BufferSource argument is empty
ℹ tests 16  ℹ pass 0  ℹ fail 16
```

**Passthrough wasm**: the same exports, `wap_process` copies the mic to the
output, no statistics. Built with
`emcc -O2 stub.c -sSTANDALONE_WASM --no-entry -sALLOW_MEMORY_GROWTH=1`:

```c
#include <stdlib.h>
#include <string.h>
typedef struct { int rate, frame; float *mic, *ref, *out; } W;
#define E(n) __attribute__((export_name(#n)))
E(wap_create) W* wap_create(int rate, int ns, int vad) { W* w = calloc(1, sizeof(W)); w->rate = rate; w->frame = rate / 100; w->mic = calloc(w->frame, 4); w->ref = calloc(w->frame, 4); w->out = calloc(w->frame, 4); return w; }
E(wap_frame) int wap_frame(W* w) { return w->frame; }
E(wap_mic) float* wap_mic(W* w) { return w->mic; }
E(wap_ref) float* wap_ref(W* w) { return w->ref; }
E(wap_out) float* wap_out(W* w) { return w->out; }
E(wap_process) int wap_process(W* w) {
#ifdef MUTE
  memset(w->out, 0, w->frame * 4);
#else
  memcpy(w->out, w->mic, w->frame * 4);
#endif
  return 0; }
E(wap_voice) int wap_voice(W* w) { return -1; }
E(wap_stats) int wap_stats(W* w, double* o) { return 0; }
E(wap_destroy) void wap_destroy(W* w) { free(w->mic); free(w->ref); free(w->out); free(w); }
E(wap_alloc) void* wap_alloc(int n) { return malloc(n); }
E(wap_free) void wap_free(void* p) { free(p); }
```

```
worklet 16000 Hz: … "stats":{"delayMs":null,"erleDb":null,…} "echo":{"erleDb":-0.0002,…} "talk":{"nearGain":-0.20,"nearCorr":-0.18,…}
browser-cert: FAIL packages/webrtc-audio-processing/cert/worklet.mjs
AssertionError [ERR_ASSERTION]: 16000 Hz: ERLE -0.0 dB in the worklet
✖ a delayed, attenuated echo is cancelled: … AssertionError: ERLE -0.0 dB
✖ the delay estimate is within 12 ms …: AssertionError: echo at 40 ms: delayMs null
✖ cancel() lags its input by latencySamples …: AssertionError: measured lag 160
✖ double talk keeps the near end …: AssertionError: near-end gain 0.035
ℹ tests 16  ℹ pass 4  ℹ fail 12
```

(The four that pass test the JS wrapper's own checks: synchronous
instantiation, option refusals and the reference queue.)

**Muting wasm** (the same stub with `-DMUTE`: all echo gone, and the near
end with it). Its "ERLE" is over 200 dB, so only the other cases catch it:

```
worklet 16000 Hz: … "echo":{"erleDb":215.9,…} "talk":{"nearGain":0,"nearCorr":0,…}
browser-cert: FAIL packages/webrtc-audio-processing/cert/worklet.mjs
AssertionError [ERR_ASSERTION]: 16000 Hz: stats().erleDb null
✖ double talk keeps the near end …: AssertionError: near-end gain 0.000
✖ cancel() lags its input by latencySamples …: AssertionError: measured lag 0
ℹ tests 16  ℹ pass 4  ℹ fail 12
```

### The specs aren't vacuous

- The far end is a synthetic voice (a gliding 20-harmonic tone with noise
  and a syllable envelope); the echo is that, 80 ms later (40 to 300 ms in
  the delay case), through a four-tap room at -6 dB, plus a -60 dB noise
  floor. ERLE is measured on the output against the mic, from 4 s on, at
  `latencySamples`.
- Double talk adds a second voice (another pitch and seed) from 8 to 11 s:
  its projection onto the output must keep at least half its amplitude and
  correlate at 0.6 or better, while the echo stays at least 15 dB down
  before and after it. A canceller that mutes passes ERLE and fails this.
- The latency case measures the output's lag behind noise bursts with no far
  end, with and without noise suppression, and it must be exactly
  `latencySamples`: 288/384 samples at 16 kHz and 910/1198 at 48 kHz.
- The worklet's output must be bit-identical to the page's main thread
  running the same signal in 128-sample chunks, and to an instance made from
  the bytes rather than a `WebAssembly.Module`. The worklet reports
  `AudioWorkletGlobalScope` with no `fetch` and no `importScripts`.
