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

## 1.23.6-2: the relink kit on main (homescoop#398)

`packages/libheif/build.sh` of 1.23.6-1, built from main (aea44b6f, macOS,
Emscripten 4.0.23, 2026-10-16), fails twice:

- check-slicc-cred, before packing: at -O3 emcc minifies the wasm's import
  and export names (`a.a`, `Ba`), so the credential library is invisible:

  ```
  homescoop: bin/heif-dec.wasm (an Emscripten command) lacks the slicc credential library (import slicc_cred_js, export slicc_cred_euid): slicc-kernel shows every file as 1000:1000 under users (homescoop#459)
  ```

- its staged relink kit has only `js/slicc-writev.js`, while `ldflags.txt`
  names `js/slicc-linkat.js` and `js/slicc-uname.js` too, and the credential
  library by its build-host path. `relink.sh` from that kit:

  ```
  FileNotFoundError: [Errno 2] No such file or directory: 'js/slicc-linkat.js'
  ```

  and `cert/lib/relink-check.mjs` on that kit, packed:

  ```
  Error: relink kit ldflags.txt names build-host paths: /tmp/thr_kkndz93sn6/work-heif-main/slicc-cred-d8e86774e15318f3/libslicc_cred.a (homescoop#398)
  ```

1.23.6-2 links the programs at -O2 (check-slicc-cred: 2 of 2 with
credentials) and copies every file the flags name into the kit; relink-check
then relinks heif-dec and heif-info and decodes rainbow-451x461.heic to the
host pixels.

## 1.23.6-4: attested build inputs (homescoop#864; 2026-10-17)

1.23.6-4 changes only the build inputs: wasm-zlib 1.3.1-4 (was 1.3.1-3, which has no provenance), wasm-libjpeg-turbo 3.1.2-4 (was 3.1.2-2, a laptop publish), and wasm-libpng 1.6.59-3 (was 1.6.59-1, a laptop publish). The library versions behind them, and so the THIRD-PARTY-NOTICES text, stay the same. The cert kernel moves from 1.72.0 to 1.110.1 (certified). libheif's code and patches are unchanged, so the published 1.23.6-3 passes these specs too, and the negatives above still stand.
