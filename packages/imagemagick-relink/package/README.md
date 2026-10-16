# `@ai-ecoverse/wasm-imagemagick-relink`

The LGPL relink kits of
[`@ai-ecoverse/wasm-imagemagick`](https://github.com/ai-ecoverse/homescoop/tree/main/packages/imagemagick)
and
[`@ai-ecoverse/wasm-imagemagick-heif`](https://github.com/ai-ecoverse/homescoop/tree/main/packages/imagemagick-heif)
of the **same version** as this package. Their `bin/magick.wasm` links its
libraries statically, among them GNU libiconv (LGPL-2.1-or-later, through
libxml2) and, in the heif build, libheif and libde265 (LGPL-3.0-or-later).
With a kit you can link `magick` again against your own build of any of
them. You don't need this package to run ImageMagick (homescoop#593).

## Relinking

| Kit | For |
| --- | --- |
| `share/imagemagick/relink/` | `@ai-ecoverse/wasm-imagemagick` |
| `share/imagemagick-heif/relink/` | `@ai-ecoverse/wasm-imagemagick-heif` |

Each kit holds magick's objects (`magick.a`, `libMagickCore-7.Q16HDRI.a`,
`libMagickWand-7.Q16HDRI.a`), the static libraries of the link
(`liblcms2.a`, `libtiff.a`, `libjpeg.a`, `libfreetype.a`, `libpng16.a`,
`libz.a`, `libwebpmux.a`, `libwebpdemux.a`, `libwebp.a`, `libsharpyuv.a`,
`libopenjp2.a`, `libxml2.a`, `libiconv.a`, the slicc shims `libslicc-cli.a`
and `libslicc_cred.a`), the link flags (`ldflags.txt`, with the
`--js-library` files in `js/`), `relink.sh`, the notices of its build
(`THIRD-PARTY-NOTICES.md`) and `kit.json`: the sha256, size and import and
export hashes of the `bin/magick.wasm` these objects made.

`relink.sh <out-dir> [dir]` links `magick` and `magick.wasm` into
`<out-dir>`. A static library in `dir` with the name of one of the kit's
replaces the kit's copy. For the heif kit, `dir` is required and also holds
libheif, libde265 and dav1d (`libheif.a`, `libde265.a`, `libdav1d.a`,
from `@ai-ecoverse/wasm-libheif`'s `lib/` or your own build). With
Emscripten 4.0.23:

```bash
npm pack @ai-ecoverse/wasm-imagemagick-relink@<version> && tar xzf ai-ecoverse-wasm-imagemagick-relink-*.tgz
mkdir -p /tmp/libs && cp /path/to/your/libiconv.a /tmp/libs/
bash package/share/imagemagick/relink/relink.sh /tmp/relinked /tmp/libs
cp /tmp/relinked/magick /tmp/relinked/magick.wasm node_modules/@ai-ecoverse/wasm-imagemagick/bin/
```

The kits come from the same build as the runtime packages:
[`build.sh`](https://github.com/ai-ecoverse/homescoop/tree/main/packages/imagemagick-relink)
runs `packages/imagemagick/build.sh` and `packages/imagemagick-heif/build.sh`
and keeps their objects. ladder-pr relinks both kits on every build
(`cert/relink-check.mjs`), with libiconv.a from `@ai-ecoverse/wasm-libiconv`,
and checks the result against `kit.json`.
