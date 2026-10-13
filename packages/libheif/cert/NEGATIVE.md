# Negative proof (libheif)

**Date:** 2026-10-13, slicc-kernel 1.72.0, on a local build of 1.23.6-1 (emsdk 4.0.23).
This is a new package, so it needs human cert first and is not in `scripts/ci-certified.json`.

## Empty wasm

`prove-negative.mjs` truncates `bin/heif-dec.wasm` and `bin/heif-info.wasm`
to 0 bytes. The checklist then fails at the first command:

```
browser-cert: FAIL packages/libheif/cert/checklist.mjs
Error: Error: WebAssembly.compile(): BufferSource argument is empty
prove-negative: ok — cert failed on bad libheif tarball (status 1)
```

## Patches

- `emscripten-decode.patch`: rebuilt without it, upstream's `__EMSCRIPTEN__`
  branch turns off libde265's deblocking filter and SAO. The checklist fails
  at the first pixel case, the iPhone 13 Pro Max still:

  ```
  AssertionError [ERR_ASSERTION]: iphone13.png: pixels differ from host libheif 1.23.6 beyond the 0 listed samples
  + 'a7d252574b9c5993c8b59dab6ee623f56f49a35c26e3af5a26e907269180d301'
  - 'a33d59bb9baf74704cedb6aa4b59e401a69156df1e0bae98a2bf82228f941d6d'
  ```

  Compared with Homebrew's heif-convert 1.23.6, the unpatched build gets
  3,465,569 of the 36,578,304 samples of that image wrong (by up to 13), and
  64,815 of 623,733 in rainbow-451x461.heic (by up to 5). The patched build
  gets 0 wrong in both.
- `no-embind.patch`: without it, linking heif-dec fails with
  `wasm-ld: error: ../libheif/libheif.a(heif.cc.o): undefined symbol: _embind_register_function`.

## Wrong output inside the spec

Every PNG case compares a SHA-256 over the decoded samples with host libheif's,
heif-info's stdout with the host's, and the corrupt-input cases require
libheif's own rc and message with no trap. So any wrong pixel, header line or
exit status fails.
