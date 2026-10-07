# Negative proof (sed)

**Date:** 2026-10-07  
No SLICC patches on this package.

## Empty wasm

`prove-negative.mjs --package sed` → FAIL (`WebAssembly.compile(): BufferSource argument is empty`).

## Wrong-output case (in-spec)

`cert/checklist.mjs` asserts `sed -i` rewrites the file to `beta\n` and that
`sed e` on a pattern-space shell command prints `sed-e-ok\n`.
