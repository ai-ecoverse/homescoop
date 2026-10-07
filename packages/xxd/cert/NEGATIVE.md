# Negative proof (xxd)

**Date:** 2026-10-07  
No SLICC patches on this package.

## Empty wasm

`prove-negative.mjs --package xxd` → FAIL (`WebAssembly.compile(): BufferSource argument is empty`).

## Wrong-output case (in-spec)

`cert/roundtrip.mjs` requires `xxd | xxd -r` to restore the original bytes
(`AB\n`). A no-op or truncated dump would fail the equality assert.
