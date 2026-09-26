# `@ai-ecoverse/wasm-libtiff`

libtiff **4.7.0** built for WebAssembly / emscripten, packaged by
[homescoop](https://github.com/ai-ecoverse/homescoop).

| | |
| --- | --- |
| Upstream | [libtiff](https://libtiff.gitlab.io/libtiff/) `4.7.0` |
| Recipe | [`packages/libtiff`](https://github.com/ai-ecoverse/homescoop/tree/main/packages/libtiff) |
| Build | `build.sh` (ladder `emconfigure`; deps zlib + libjpeg-turbo) |

## Contents

- `lib/libtiff.a`
- `include/tiff.h`, `tiffio.h`, `tiffvers.h`, `tiffconf.h`, `tif_config.h`
- `lib/pkgconfig/libtiff-4.pc`

## License

Homescoope packaging is Apache-2.0. Upstream remains under its own license.
