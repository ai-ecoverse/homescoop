# `@ai-ecoverse/wasm-libjpeg-turbo`

libjpeg-turbo **3.1.2** built for WebAssembly / emscripten, packaged by
[homescoop](https://github.com/ai-ecoverse/homescoop).

| | |
| --- | --- |
| Upstream | [libjpeg-turbo/libjpeg-turbo](https://github.com/libjpeg-turbo/libjpeg-turbo) `3.1.2` |
| Recipe | [`packages/libjpeg-turbo`](https://github.com/ai-ecoverse/homescoop/tree/main/packages/libjpeg-turbo) |
| Build | `build.sh` (ladder `emcmake`, `-DWITH_SIMD=0`) |

## Contents

- `lib/libjpeg.a`, `lib/libturbojpeg.a` (same archive; Magick.Native name)
- `include/jpeglib.h`, `jerror.h`, `jmorecfg.h`, `jconfig.h`
- `lib/pkgconfig/libjpeg.pc`

## License

Homescoope packaging is Apache-2.0. Upstream remains under its own license.
