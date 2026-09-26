# `@ai-ecoverse/wasm-openjpeg`

OpenJPEG **2.5.3** built for WebAssembly / emscripten, packaged by
[homescoop](https://github.com/ai-ecoverse/homescoop).

| | |
| --- | --- |
| Upstream | [uclouvain/openjpeg](https://github.com/uclouvain/openjpeg) `v2.5.3` |
| Recipe | [`packages/openjpeg`](https://github.com/ai-ecoverse/homescoop/tree/main/packages/openjpeg) |
| Build | `build.sh` (ladder `emcmake`, `BUILD_CODEC=OFF`) |

## Contents

- `lib/libopenjp2.a`
- `include/openjpeg.h`, `opj_config.h` (and `include/openjpeg-2.5.3/`)
- `lib/pkgconfig/libopenjp2.pc`

## License

Homescoope packaging is Apache-2.0. Upstream remains under its own license.
