# `@ai-ecoverse/wasm-libjpeg-turbo`

libjpeg-turbo **3.2.1** built for WebAssembly / emscripten, packaged by
[homescoop](https://github.com/ai-ecoverse/homescoop).

| | |
| --- | --- |
| Upstream | [libjpeg-turbo/libjpeg-turbo](https://github.com/libjpeg-turbo/libjpeg-turbo) `3.2.1` |
| Recipe | [`packages/libjpeg-turbo`](https://github.com/ai-ecoverse/homescoop/tree/main/packages/libjpeg-turbo) |
| Build | `build.sh` (ladder `emcmake`, `-DWITH_SIMD=0`) |

## Contents

- `lib/libjpeg.a`, `lib/libturbojpeg.a` (same archive; Magick.Native name)
- `include/jpeglib.h`, `jerror.h`, `jmorecfg.h`, `jconfig.h`
- `lib/pkgconfig/libjpeg.pc`

## License

Homescoope packaging is Apache-2.0. Upstream remains under its own license.

## Reproducible build stamp

After the SHA-256 check, `build.sh` takes the newest regular-file mtime in the
upstream tarball as `SOURCE_DATE_EPOCH` and passes its UTC date to CMake's
`BUILD`. The recipe does not pin that epoch: Renovate version bumps keep the
stamp tied to the downloaded release. For 3.2.1 the newest file is dated
`1793032299` (`2026-10-26T16:31:39Z`), so both shipped archives must contain
`(build 20261026)`.

The host cert downloads the recipe's source (sha256-checked) and compares every
embedded build stamp in `lib/libjpeg.a` and `lib/libturbojpeg.a` with that
tarball's newest mtime:

```sh
node packages/libjpeg-turbo/cert/build-stamp.mjs --tarball .homescoop-out/package.tgz
```

### NEGATIVE (#1977)

Before 3.2.1-1, the published `3.2.0-2` release embedded `(build 20260630)`
from that release's newest mtime; since 3.2.1-1 the stamp comes from the
tarball and expects `20261026`, so the same cert run against `3.2.0-2` fails.
