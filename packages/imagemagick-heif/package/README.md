# `@ai-ecoverse/wasm-imagemagick-heif`

[ImageMagick](https://imagemagick.org/) 7.1.2-32 `magick` CLI for
[slicc](https://github.com/ai-ecoverse/slicc)'s wasm realm, **with HEIC /
HEIF / AVIF reading** through [libheif](https://github.com/strukturag/libheif)
1.23.6. It is the same build as `@ai-ecoverse/wasm-imagemagick`, with the same
version line and the same commands (`magick`, plus `convert`, `identify` and
`mogrify` as argv0 aliases), plus the HEIC delegate. Install one of the two,
not both.

> **Optional package, HEVC inside.** This build links
> [libde265](https://github.com/strukturag/libde265), an HEVC (H.265)
> decoder, and **HEVC is patent-encumbered**: depending on where and how you
> use it, decoding HEVC may need a patent licence. That's why this is a
> separate package, never part of a base set, and why the default
> `@ai-ecoverse/wasm-imagemagick` stays HEVC-free. AVIF is decoded by
> [dav1d](https://code.videolan.org/videolan/dav1d) (royalty-free).
> HEIC/AVIF are read-only: there is no encoder.

```bash
pnpm add -g @ai-ecoverse/wasm-imagemagick-heif
magick IMG_0001.HEIC IMG_0001.png
magick IMG_0001.HEIC -resize 25% -quality 85 small.jpg
identify IMG_0001.HEIC
identify -format '%w %h %[orientation] %[EXIF:Model]\n' IMG_0001.HEIC
magick multi.heic out-%d.png                          # one file per top-level image
convert 'multi.heic[1]' second.png
identify -define heic:depth-image=true portrait.heic # also the depth map
magick -define heic:preserve-orientation=true IMG_0001.HEIC -auto-orient out.png
```

HEIF rotation and mirroring are applied when an image is read, so iPhone
photos come out upright and `%[orientation]` is `TopLeft`. To get the stored
orientation instead, use `-define heic:preserve-orientation=true` (the stored
pixels, plus the orientation, which `-auto-orient` then applies).

The other delegates are those of `@ai-ecoverse/wasm-imagemagick`: jpeg, png,
tiff, jp2 (openjpeg), lcms. Configure XMLs ship under `etc/ImageMagick-7/`.

## Licences

`LICENSE` is ImageMagick's. `THIRD-PARTY-NOTICES.md` has the licences of the
libraries `bin/magick.wasm` links statically, among them libheif 1.23.6 and
libde265 1.1.3 (LGPL-3.0-or-later), dav1d 1.5.4 (BSD-2-Clause) and
Emscripten's runtime. The notice list is the same as wasm-imagemagick's, plus
those three.
The libheif, libde265 and dav1d builds are the ones in
[`@ai-ecoverse/wasm-libheif`](https://github.com/ai-ecoverse/homescoop/tree/main/packages/libheif).

## Relinking (LGPL)

`share/imagemagick-heif/relink/` holds what you need to relink `magick`
against your own libheif or libde265: magick's objects (`magick.a`,
`libMagickCore-7.Q16HDRI.a`, `libMagickWand-7.Q16HDRI.a`), the other static
libraries (`liblcms2.a`, `libtiff.a`, `libjpeg.a`, `libpng16.a`, `libz.a`,
`libopenjp2.a`, `libslicc-cli.a`), the slicc link flags (`ldflags.txt`,
`js/`) and `relink.sh`. libheif, libde265 and dav1d themselves come from
`@ai-ecoverse/wasm-libheif` (its `lib/`) or from your own build. With
Emscripten 4.0.23:

```bash
cd node_modules/@ai-ecoverse/wasm-imagemagick-heif
bash share/imagemagick-heif/relink/relink.sh /tmp/relinked /path/to/dir/with/libheif.a+libde265.a+libdav1d.a
cp /tmp/relinked/magick /tmp/relinked/magick.wasm bin/
```

The full source build is
[`packages/imagemagick-heif/build.sh`](https://github.com/ai-ecoverse/homescoop/tree/main/packages/imagemagick-heif)
and its recipe. ladder-pr runs this relink on every build
(`cert/lib/relink-check.mjs`).
