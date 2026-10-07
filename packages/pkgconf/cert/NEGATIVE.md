# Negative proof (pkgconf)

**Date:** 2026-10-07  
No SLICC patches on this package.

## Empty wasm

`prove-negative.mjs --package pkgconf` → FAIL (`WebAssembly.compile(): BufferSource argument is empty`).

## Wrong-output case (in-spec)

`cert/pc.mjs` requires `--modversion homescoop-cert` → `9.9.9` from a staged
`.pc`, and a missing package must exit non-zero.
