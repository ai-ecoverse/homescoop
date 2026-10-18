# Negative proof (wasm-lcms2)

**Date:** 2026-10-17, for 2.19.1-3, the package's first cert (homescoop#426). This is `node scripts/em-lib-cert.mjs lcms2`, using emsdk 4.0.23 on darwin-arm64.

2.19.1-3 is a CI rebuild of the same pinned source. Its only change is that it drops the build input wasm-zlib 1.3.1-2, which is unattested (homescoop#864). lcms2, configured `--without-jpeg --without-tiff`, never includes or links zlib. The library code doesn't change, so the published 2.19.1-2 passes the spec too, and the negative is a planted defect.

## A broken .pc

The build's tarball, with `lib/pkgconfig/lcms2.pc` changed so that `-llcms2` is dropped from its `Libs`, fails the cert. A consumer that builds from the `.pc` alone can't build:

```text
wasm-ld: error: …/probe.o: undefined symbol: cmsCreate_sRGBProfile
```

## The spec isn't vacuous

`test/probe.c` is compiled from the `.pc` flags alone and linked with `-Wl,--fatal-warnings`. It runs real work through the library and checks the results; see the checklist in `meta.json`. `test/check.mjs` then reads the file the probe wrote, independently in Node, and checks it.

## 2.19.1-4: no DWARF, no build paths (homescoop#908; 2026-10-17)

`node scripts/check-no-debug.mjs lcms2` (host-run's #908 check) fails on the published 2.19.1-3: 1 file(s) ship 907,990 bytes of DWARF.

The published 2.19.1-3 also has 26 occurrence(s) of the CI build directory `/tmp/homescoop-work` in lib/liblcms2.a (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

2.19.1-4 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 2.19.1-3 too; the negative is the #908 check.
