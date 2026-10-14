# `@ai-ecoverse/wasm-imagemagick`

[ImageMagick](https://imagemagick.org/) 7.1.2-33 `magick` CLI for
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

## Resource limits

The default `etc/ImageMagick-7/policy.xml` is sized for a browser tab, where
the wasm heap tops out at 2 GiB and a runaway allocation can freeze the tab:

| Resource | Limit | Why |
| --- | --- | --- |
| width, height | 16000 px | a 30000x30000 request fails at once instead of allocating |
| area | 64 MP | a 48 MP phone photo (8064x6048) fits |
| memory | 768 MiB | a 48 MP RGB image in Q16HDRI is about 580 MiB |
| map | 512 MiB | memory-mapped cache is wasm heap too: memory + map stays under 1.3 GiB |
| disk | 512 MiB | pixel-cache spill goes to the browser's storage; anything bigger fails fast |

Over a limit, magick exits 1 with `width or height exceeds limit` or
`cache resources exhausted`. `-limit` can only lower these. To lift them,
use `magick-open` (the same binary with upstream's `policy-open.xml` from
`etc/ImageMagick-7-open`), or set `MAGICK_CONFIGURE_PATH` to that directory
(`magick -list policy` shows where the package is installed):

```bash
magick-open -size 20000x1000 xc:white wide.png
MAGICK_CONFIGURE_PATH=/path/to/package/etc/ImageMagick-7-open magick ...
```

The tab can still run out of memory without limits.
