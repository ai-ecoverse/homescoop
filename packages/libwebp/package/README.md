# `@ai-ecoverse/wasm-libwebp`

**libwebp 1.6.0** static libraries for WebAssembly / emscripten, built by the
[homescoop](https://github.com/ai-ecoverse/homescoop) ladder for SLICC.

- `lib/libwebp.a`, `libwebpmux.a`, `libwebpdemux.a`, `libsharpyuv.a`
- `include/webp/*.h`, `include/sharpyuv.h`
- `lib/pkgconfig/libwebp.pc`, `libwebpmux.pc`, `libwebpdemux.pc`

Link with `-lwebp -lsharpyuv -lm` (plus `-lwebpmux` / `-lwebpdemux` for the
container APIs). Built without threads and without SIMD.

CI cert: `packages/libwebp/smoke.c` encodes and decodes lossless and lossy
RGBA and checks the bitstream, the size and the pixels.

License: BSD-3-Clause. `LICENSE` holds upstream COPYING and Google's PATENTS grant.
