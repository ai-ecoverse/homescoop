# Negative proof (which)

**Date:** 2026-10-08  
New package — not in `ci-certified.json` until thr_b83wwqmt4e human-certifies
the first `@ai-ecoverse/wasm-which` release (no automerge).

## Empty wasm

`prove-negative.mjs --package which` → FAIL
(`WebAssembly.compile(): BufferSource argument is empty`).

## Spec non-vacuous

`cert/checklist.mjs` requires:

- `which ls` returns a `/bin` or `/usr/bin` path
- `which -a` lists two PATH providers for the same name
- missing command exits 1
- `which which` finds itself
