# Negative proof (xz)

## 5.8.4: patch absorbed upstream (2026-10-09)

xz 5.8.4's `src/common/mythread.h` uses `sigprocmask()` for single-threaded
builds when `!defined(__wasm__) || defined(__EMSCRIPTEN__)`, which is what
`wasm-mythread-sigmask.patch` added, so the patch is gone and no longer
listed in `cert/meta.json`. The `-T0` / `-T2` 4 MiB cases in
`cert/roundtrip.mjs` stay as the regression check for that path; the
empty-wasm proof below still holds. The patch-reverted proof below is the
5.8.1 record.

**Date:** 2026-10-07

## Empty wasm (spec not vacuous)

`node scripts/browser-cert/prove-negative.mjs --package xz --tarball <good.tgz>`  
→ FAIL: `WebAssembly.compile(): BufferSource argument is empty`.

## Patch reverted (exercises wasm-mythread-sigmask.patch)

On homescoop `main` at xz 5.8.1, remove `packages/xz/wasm-mythread-sigmask.patch` and run `bash scripts/host-run.sh xz`.

**Result:** compile fails in `src/xz/signals.c`:

```text
signals.c:146:4: error: call to undeclared function 'mythread_sigmask'
```

Without the patch, `__wasm__` keeps `mythread_sigmask` out of `mythread.h`, so the
CLI cannot build. The threaded/large cases in `cert/roundtrip.mjs` (`xz -T0` /
`-T2` over 4 MiB) are the runtime path that needs that symbol once linked.

**Good tarball:** `@ai-ecoverse/wasm-xz@5.8.1-1` — `cert/roundtrip.mjs` passes
(including `-T0`/`-T2` 4 MiB).
