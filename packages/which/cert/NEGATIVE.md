# Negative proof (which)

**Date:** 2026-10-08  
CI-certified (thr_b83wwqmt4e): `@ai-ecoverse/wasm-which@2.23.0-1` on slicc-kernel #88 / 1.12+; listed in `scripts/ci-certified.json`.

## Empty wasm

`prove-negative.mjs --package which` → FAIL
(`WebAssembly.compile(): BufferSource argument is empty`).

## Spec non-vacuous

`cert/checklist.mjs` requires:

- `which ls` returns a `/bin` or `/usr/bin` path
- `which -a` lists two PATH providers for the same name
- missing command exits 1
- `which which` finds itself
