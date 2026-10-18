# Negative proof (wasm-libpng)

**Date:** 2026-10-17, for 1.6.59-3, the package's first cert (homescoop#426). This is `node scripts/em-lib-cert.mjs libpng`, using emsdk 4.0.23 on darwin-arm64.

1.6.59-3 is a CI rebuild of the same pinned source. Its only change is the build input, now wasm-zlib 1.3.1-4 (it was the unattested 1.3.1-2, homescoop#864). The library code doesn't change, so the published 1.6.59-2 passes the spec too, and the negative is a planted defect.

## A broken .pc

The build's tarball, with `lib/pkgconfig/libpng.pc` changed so that its `Requires: zlib` is emptied, fails the cert. A consumer that builds from the `.pc` alone can't build:

```text
fatal error: 'zlib.h' file not found
```

## The spec isn't vacuous

`test/probe.c` is compiled from the `.pc` flags alone and linked with `-Wl,--fatal-warnings`. It runs real work through the library and checks the results; see the checklist in `meta.json`. `test/check.mjs` then reads the file the probe wrote, independently in Node, and checks it.

## 1.6.59-4: no DWARF, no build paths (homescoop#908; 2026-10-17)

`node scripts/check-no-debug.mjs libpng` (host-run's #908 check) fails on the published 1.6.59-3: 2 file(s) ship 1,088,642 bytes of DWARF.

The published 1.6.59-3 also has 30 occurrence(s) of the CI build directory `/tmp/homescoop-work` in lib/libpng16.a, lib/libpng.a (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

1.6.59-4 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 1.6.59-3 too; the negative is the #908 check.
