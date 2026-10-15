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
| width, height | 16000 px | a 30000x30000 request fails at once instead of allocating |
| area | 64 MP | a 48 MP phone photo (8064x6048) fits |
| memory | 1536 MiB | a 48 MP RGB image in Q16HDRI is about 580 MiB; resizing holds the source and the result |
| map | 256 MiB | in wasm the memory-mapped cache is heap too: memory + map is 1.75 GiB, under the build's 2 GiB maximum |
| disk | 0 | no pixel cache on disk: in the browser that spills to storage and a 48 MP resize took minutes; anything over memory fails at once |

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
