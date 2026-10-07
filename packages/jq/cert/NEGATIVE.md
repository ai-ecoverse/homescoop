# Negative proof (jq)

**Date:** 2026-10-07  
No SLICC patches on this package.

## Empty wasm

`prove-negative.mjs --package jq` → FAIL (`WebAssembly.compile(): BufferSource argument is empty`).

## Wrong-output case (in-spec)

`cert/basic.mjs` asserts `jq -n '1+1'` stdout is exactly `2\n` and that invalid
JSON exits non-zero. A build that always printed `0\n` or accepted bad JSON
would fail those asserts (covered by the positive assertions themselves).
