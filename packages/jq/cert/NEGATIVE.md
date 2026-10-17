# Negative proof (jq)

**Date:** 2026-10-07  
No SLICC patches on this package.

## Empty wasm

`prove-negative.mjs --package jq` → FAIL (`WebAssembly.compile(): BufferSource argument is empty`).

## Wrong-output case (in-spec)

`cert/basic.mjs` asserts `jq -n '1+1'` stdout is exactly `2\n` and that invalid
JSON exits non-zero. A build that always printed `0\n` or accepted bad JSON
would fail those asserts (covered by the positive assertions themselves).

## 1.8.2-4: no DWARF, no build paths (homescoop#908; 2026-10-17)

`node scripts/check-no-debug.mjs jq` (host-run's #908 check) fails on the published 1.8.2-3: 1 file(s) ship 2,001,053 bytes of DWARF.

The published 1.8.2-3 also has 2 occurrence(s) of the CI build directory `/tmp/homescoop-work` in bin/jq.wasm (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

1.8.2-4 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 1.8.2-3 too; the negative is the #908 check.
