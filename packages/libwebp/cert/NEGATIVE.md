# Negative proof (wasm-libwebp)

**Date:** 2026-10-17, for 1.6.0-3, the package's first cert (homescoop#426). Run with `node scripts/em-lib-cert.mjs libwebp`, using emsdk 4.0.23 on darwin-arm64.

## The published 1.6.0-2

`libwebp.pc` in 1.6.0-2 says `Libs: -L${libdir} -lwebp` and nothing else. The package ships no `libsharpyuv.pc`, although `libwebp.a`'s encoder calls into `libsharpyuv.a`. A consumer that links from the `.pc` can't link, so the probe fails:

```text
wasm-ld: error: …/lib/libwebp.a(libwebpencode_la-picture_csp_enc.o): undefined symbol: SharpYuvInit
wasm-ld: error: …/lib/libwebp.a(libwebpencode_la-picture_csp_enc.o): undefined symbol: SharpYuvGetConversionMatrix
wasm-ld: error: …/lib/libwebp.a(libwebpencode_la-picture_csp_enc.o): undefined symbol: SharpYuvConvert
```

ImageMagick 7.1.2-34-7's link stopped at exactly these symbols (homescoop#929, ladder-pr). 1.5.0-1 shipped no `.pc` at all, so ImageMagick's `homescoop_ensure_prefix_pcs` used to synthesize one with `Requires: libsharpyuv`. 1.6.0-2's own `.pc` replaced that synthesized one.

## 1.6.0-3

`build.sh` writes `libsharpyuv.pc` (`-lsharpyuv`), and `libwebp.pc` now has `Requires: libsharpyuv`, matching what `homescoop_ensure_prefix_pcs` writes. The probe links, and every check passes:
- lossless round trip exact;
- lossy and sharp-YUV within limits, alpha exact;
- a WebPMux file with EXIF, which Node reads back.

## 1.6.0-4: no DWARF, no build paths (homescoop#908; 2026-10-17)

`node scripts/check-no-debug.mjs libwebp` (host-run's #908 check) fails on the published 1.6.0-3: 4 file(s) ship 1,360,736 bytes of DWARF.

The published 1.6.0-3 also has 125 occurrence(s) of the CI build directory `/tmp/homescoop-work` in lib/libsharpyuv.a, lib/libwebp.a, lib/libwebpdemux.a (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

1.6.0-4 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 1.6.0-3 too; the negative is the #908 check.

The probe now exercises sharp YUV for real (homescoop#931): ARGB import with and without `use_sharp_yuv` must give different bitstreams (310 vs 304 bytes locally). It also exercises SharpYuvGetVersion through libsharpyuv.pc and frame 1 through WebPDemux.
