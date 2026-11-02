# `@ai-ecoverse/wasm-libjpeg-turbo`

libjpeg-turbo **3.2.0** built for WebAssembly / emscripten, packaged by
[homescoop](https://github.com/ai-ecoverse/homescoop).

| | |
| --- | --- |
| Upstream | [libjpeg-turbo/libjpeg-turbo](https://github.com/libjpeg-turbo/libjpeg-turbo) `3.2.0` |
| Recipe | [`packages/libjpeg-turbo`](https://github.com/ai-ecoverse/homescoop/tree/main/packages/libjpeg-turbo) |
| Build | `build.sh` (ladder `emcmake`, `-DWITH_SIMD=0`) |

## Contents

- `lib/libjpeg.a`, `lib/libturbojpeg.a` (same archive; Magick.Native name)
- `include/jpeglib.h`, `jerror.h`, `jmorecfg.h`, `jconfig.h`
- `lib/pkgconfig/libjpeg.pc`

## License

Homescoope packaging is Apache-2.0. Upstream remains under its own license.

## Reproducible build stamp

`source.epoch` is the newest regular-file mtime in the SHA-256-verified
upstream tarball. For this release it is `1782840343`
(`2026-06-30T17:25:43Z`, `libjpeg-turbo-3.2.0/BUILDING.md`). The build
exports it as `SOURCE_DATE_EPOCH` and passes its UTC date to CMake's
`BUILD`, so both shipped archives must contain `(build 20260630)`.

The host cert compares every embedded build stamp in `lib/libjpeg.a` and
`lib/libturbojpeg.a` with the current recipe epoch:

```sh
node packages/libjpeg-turbo/cert/build-stamp.mjs --tarball .homescoop-out/package.tgz
```

### NEGATIVE (#1953)

The same cert run against the published `3.2.0-1` tarball fails:
`lib/libjpeg.a: build stamp must match source.epoch 1782840343 (UTC)`;
actual `20250827`, expected `20260630`. Packaging revision `3.2.0-2`
refreshes the epoch; the upstream version and source checksum stay the same.
