# Negative proof (git)

**Date:** 2026-10-07  
No SLICC patches on this package.

## Empty wasm

`prove-negative.mjs --package git` → FAIL (`WebAssembly.compile(): BufferSource argument is empty`).

## Wrong-output case (in-spec)

`cert/checklist.mjs` asserts clone/show after push yields
`homescoop-git-cert\n`, then after fetch/merge `homescoop-git-cert-2\n`.
