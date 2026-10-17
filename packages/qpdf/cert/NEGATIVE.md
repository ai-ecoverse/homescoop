# Negative proof (qpdf)

**Date:** 2026-10-09
New package, so it needs human cert first and is not in `scripts/ci-certified.json`.

## Empty wasm

With `bin/qpdf.wasm` truncated to 0 bytes, the checklist fails at the first
`qpdf` run (slicc-kernel 1.23.0, Node entry):

```
CompileError: WebAssembly.compile(): BufferSource argument is empty
```

## Spec non-vacuous

`cert/checklist.mjs` compares page texts in order after merge, ranges, split
and decrypt, reads `/Rotate` back per page from `--json`, checks exact exit
codes for the encryption queries, both password failures and the corrupt
inputs (2 for garbage and a missing file, 3 for a truncated PDF), and asserts
that the hand-edited QDF file draws warnings before `fix-qdf` and none after.

## The slicc shims and credentials (12.4.2-1, #459, #625)

`12.4.2-1`'s `bin/qpdf.wasm` exports none of the slicc shims' symbols. CMake's Release type adds `-O3` to the link, and `emcc -O3` drops their `EMSCRIPTEN_KEEPALIVE` exports. On main, host-run's `check-slicc-cred.mjs` therefore refused to build qpdf: `bin/qpdf.wasm`, `fix-qdf.wasm` and `zlib-flate.wasm` lacked the slicc credential library. 12.4.2-2 builds with `CMAKE_C_FLAGS_RELEASE` and `CMAKE_CXX_FLAGS_RELEASE` set to `-DNDEBUG`, so it compiles and links at `-O2`. Its wasm exports `slicc_sig_mask` and `slicc_cred_euid`, and imports `slicc_cred_js`.

## users.mjs (users enforce, #723)

**Date:** 2026-10-16, slicc-kernel 1.102.6 `--users enforce`.

- `prove-negative.mjs --package qpdf --spec users.mjs --users enforce` → FAIL
  (`WebAssembly.compile(): BufferSource argument is empty`).
- The npm build without the credential library (curl 8.22.0-4, qpdf
  12.4.2-1) passes users.mjs on 1.102.6 too: the kernel refuses the opens
  and stamps the creator's ids itself. The spec guards the behaviour as a
  non-root user; host-run's `check-slicc-cred.mjs` guards the link. That
  build fails glue-by-path (0644 glue, `EACCES`).

## 12.4.2-3: attested build inputs (homescoop#864; 2026-10-17)

12.4.2-3 changes only the build inputs: wasm-zlib 1.3.1-4 (was the unattested 1.3.1-2) and wasm-libjpeg-turbo 3.1.2-4 (was 3.1.2-1, the latest is used now). The cert kernel is 1.110.1 (certified), and the coreutils pin is 9.12.0-9. The qpdf code is unchanged, so the published 12.4.2-2 passes these specs too, and the negatives above still stand. This build passes `checklist.mjs`, `users.mjs` and glue by path on 1.110.1 under users enforce.
