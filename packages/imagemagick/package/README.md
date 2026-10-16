# `@ai-ecoverse/wasm-imagemagick`

[ImageMagick](https://imagemagick.org/) 7.1.2-34 `magick` CLI for
[slicc](https://github.com/ai-ecoverse/slicc)'s wasm realm. `convert`,
`identify`, and `mogrify` are argv0 aliases of the same binary.

For HEIC/HEIF/AVIF, use `@ai-ecoverse/wasm-imagemagick-heif` instead (optional:
it contains an HEVC decoder). Both have the same commands, so install one of the two.

Delegates: zlib, jpeg, png, tiff, webp, openjpeg, lcms2, freetype, libxml2.

Since 7.1.2-32-4 all of them are linked; 7.1.2-32-3 and older built without
webp, freetype and libxml2 (no WebP, no `-annotate`/TTF, no MSL or internal
SVG renderer), though this list named them. There is no fontconfig and no
bundled font: give text commands a font file with `-font path/to/font.ttf`
(or a Type 1 `.pfb`).
Configure XMLs ship under `etc/ImageMagick-7/`; the slicc manifest sets
`MAGICK_CONFIGURE_PATH` so `colors.xml` / `policy.xml` resolve.
SVG goes through the internal MSVG renderer: `delegates.xml` has no
inkscape or rsvg-convert entries, as neither program exists in slicc.

WebP lossless (`-define webp:lossless=true`) drops the RGB of fully transparent
pixels, as libwebp does by default; add `-define webp:exact=true` to keep it.

```bash
pnpm add -g @ai-ecoverse/wasm-imagemagick
magick -version
convert logo: out.png
```

## Switching

`@ai-ecoverse/wasm-imagemagick` and `@ai-ecoverse/wasm-imagemagick-heif` are
drop-in alternatives with the same commands (`magick`, `convert`,
`identify`, `mogrify`, `magick-open`). Install one of them. To switch,
remove the other first:

```bash
pnpm remove -g @ai-ecoverse/wasm-imagemagick-heif
pnpm add -g @ai-ecoverse/wasm-imagemagick
magick -version   # "Delegates (built-in):" lists heic only for wasm-imagemagick-heif
```

With both installed, one package provides the shared commands and the other
is ignored without a warning. wasm-imagemagick-heif declares
`"slicc": { "replaces": ["@ai-ecoverse/wasm-imagemagick"] }`: with
slicc-kernel 1.94.0 or later it wins automatically when both are installed
together (e.g. both global). On older kernels this package wins, so remove
it first.

## Resource limits

The default `etc/ImageMagick-7/policy.xml` is sized for a browser tab, where
the wasm heap tops out at 2 GiB and a runaway allocation can freeze the tab:

| Resource | Limit | Why |
| --- | --- | --- |
| width, height | 64000 px | only absurd sizes; area bounds what an image costs, so an 18000x3000 panorama works |
| area | 64 MP | a 48 MP phone photo (8064x6048) or a 54 MP panorama (18000x3000) fits; a 30000x30000 request fails at once instead of allocating |
| memory | 1536 MiB | a 48 MP RGB image in Q16HDRI is about 580 MiB; resizing holds the source and the result |
| map | 256 MiB | in wasm the memory-mapped cache is heap too: memory + map is 1.75 GiB, under the build's 2 GiB maximum |
| disk | 0 | no pixel cache on disk: in the browser that spills to storage and a 48 MP resize took minutes; anything over memory fails at once |

Over a limit, magick exits 1 with `width or height exceeds limit` or
`cache resources exhausted`, also for `identify -format`, which decodes the
image (plain `identify` and `identify -ping` only read the header).
`-limit` can only lower these. Until 7.1.2-34-1 width and height were 16000
px, which refused panoramas wider than that (homescoop#445). To lift them,
use `magick-open` (the same binary with upstream's `policy-open.xml` from
`etc/ImageMagick-7-open`), or set `MAGICK_CONFIGURE_PATH` to that directory
(`magick -list policy` shows where the package is installed):

```bash
magick-open -size 70000x500 xc:white long.png   # wider than 64000 px
MAGICK_CONFIGURE_PATH=/path/to/package/etc/ImageMagick-7-open magick ...
```

The tab can still run out of memory without limits.

## Licences

`LICENSE` is ImageMagick's. `THIRD-PARTY-NOTICES.md` has the licences of the
libraries `bin/magick.wasm` links statically, among them GNU libiconv 1.18
(LGPL-2.1-or-later, through libxml2) and Emscripten's runtime.

## Relinking (LGPL)

`share/imagemagick/relink/` holds what you need to relink `magick` against
your own libiconv (or any other of its libraries): magick's objects
(`magick.a`, `libMagickCore-7.Q16HDRI.a`, `libMagickWand-7.Q16HDRI.a`), the
static libraries it links (`liblcms2.a`, `libtiff.a`, `libjpeg.a`,
`libfreetype.a`, `libpng16.a`, `libz.a`, `libwebpmux.a`, `libwebpdemux.a`,
`libwebp.a`, `libsharpyuv.a`, `libopenjp2.a`, `libxml2.a`, `libiconv.a`, the
slicc shims `libslicc-cli.a` and `libslicc_cred.a`), the link flags
(`ldflags.txt`, with the `--js-library` files in `js/`) and `relink.sh`. A
library in the directory you pass replaces the kit's copy of the same name.
With Emscripten 4.0.23:

```bash
cd node_modules/@ai-ecoverse/wasm-imagemagick
bash share/imagemagick/relink/relink.sh /tmp/relinked /path/to/dir/with/libiconv.a
cp /tmp/relinked/magick /tmp/relinked/magick.wasm bin/
```

The full source build is
[`packages/imagemagick/build.sh`](https://github.com/ai-ecoverse/homescoop/tree/main/packages/imagemagick)
and its recipe; libiconv's is
[`packages/libiconv`](https://github.com/ai-ecoverse/homescoop/tree/main/packages/libiconv).
ladder-pr runs this relink, with libiconv.a from `@ai-ecoverse/wasm-libiconv`,
on every build (`cert/lib/relink-check.mjs`).
