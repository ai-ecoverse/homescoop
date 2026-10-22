# `@ai-ecoverse/wasm-imagemagick-heif`

[ImageMagick](https://imagemagick.org/) 7.1.2-34 `magick` CLI for
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

The other delegates are those of `@ai-ecoverse/wasm-imagemagick`:
freetype, jpeg, jp2 (openjpeg), lcms, png, tiff, webp, xml (libxml2) and zlib.
Configure XMLs ship under `etc/ImageMagick-7/`.

WebP lossless (`-define webp:lossless=true`) drops the RGB of fully transparent
pixels, as libwebp does by default; add `-define webp:exact=true` to keep it.

WebP holds at most 16383 px a side. A wider image is refused (`width or
height exceeds limit`, rc 1) before the output is opened, so an existing
`.webp`, the input of an in-place `magick a.webp -resize 200% a.webp`
included, is left as it was (homescoop#585; until 7.1.2-34-2 it was
truncated). Resize to at most 16383 px, or write another format.

A write over an existing file (`magick … out.png`, `mogrify`) is encoded to a
temporary file and replaces the target only once the image is complete, so a
failed encode leaves the file as it was. The temporary file goes beside the
target; when that directory isn't writable (a file you may write in a
directory you may not), it goes in the first of `$MAGICK_TEMPORARY_PATH`,
`$TMPDIR` and `/tmp` that takes it, and the finished image is copied into
the file (homescoop#1656; 7.1.2-34-9.6 tried only the first of them that was
set). When no temporary file can be created anywhere, the write is refused
with the directories it tried (`unable to create temporary file 'f.png':
tried /nonexistent (No such file or directory), /tmp (Permission denied)`,
rc 1) and the file is left as it was (homescoop#1608; until 7.1.2-34-9.5 it
was written in place, and a failed encode truncated it).

`mogrify` over several files goes on with the rest when one fails (missing,
undecodable, a failed encode, or a refused write), reports each failure and
exits 1; the failed file is left as it was (homescoop#1655; until
7.1.2-34-9.6, as upstream, every file after the first failure was silently
left unchanged).

## Switching

`@ai-ecoverse/wasm-imagemagick` and `@ai-ecoverse/wasm-imagemagick-heif` are
drop-in alternatives with the same commands (`magick`, `convert`,
`identify`, `mogrify`, `magick-open`). Install one of them. To switch,
remove the other first:

```bash
pnpm remove -g @ai-ecoverse/wasm-imagemagick
pnpm add -g @ai-ecoverse/wasm-imagemagick-heif
magick -version   # "Delegates (built-in):" lists heic only for wasm-imagemagick-heif
```

With both installed, one package provides the shared commands and the other
is ignored without a warning. wasm-imagemagick-heif declares
`"slicc": { "replaces": ["@ai-ecoverse/wasm-imagemagick"] }`: with
slicc-kernel 1.94.0 or later it wins automatically when both are installed
together (e.g. both global). On older kernels the plain package wins, so
remove it first.

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

With disk at 0, MPC (which persists the pixel cache to a disk file) is
refused by policy: use `magick-open` for `.mpc`. JPEG 2000 above 16 MP is
encoded in 1024x1024 tiles, so a 48 MP image fits the heap.

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

## Writing HEIC / AVIF

There is no HEIC or AVIF encoder. Upstream ImageMagick doesn't fail when you
write one anyway: `magick in.png out.heic` (or `.heif`, `.avif`) prints
`no encode delegate for this image format 'HEIC'` as a **warning**, writes the
input's own format (PNG here) under the `.heic` name and exits **0**
(homescoop#940). Only a built-in source such as `gradient:` fails with rc 1.
Check the result with `identify out.heic`, or write PNG, JPEG, WebP or TIFF.

## Licences

`LICENSE` is ImageMagick's. `THIRD-PARTY-NOTICES.md` has the licences of the
libraries `bin/magick.wasm` links statically, among them libheif 1.23.6 and
libde265 1.1.3 (LGPL-3.0-or-later), dav1d 1.5.4 (BSD-2-Clause) and
Emscripten's runtime. The notice list is the same as wasm-imagemagick's, plus
those three.
The libheif, libde265 and dav1d builds are the ones in
[`@ai-ecoverse/wasm-libheif`](https://github.com/ai-ecoverse/homescoop/tree/main/packages/libheif).

The default font in `etc/fonts`, URW Nimbus Sans from gsfonts 8.11, is under
the GNU GPL with gsfonts' font exception: you can put these fonts in your own
non-GPLed documents. `etc/fonts/COPYING` is the GPL (version 2), and
`etc/fonts/README` is gsfonts' README, which states the exception. The
`license` field names it as `GPL-2.0-only WITH Font-exception-2.0`, the
nearest SPDX expression; the README's wording is the grant.

## Relinking (LGPL)

`bin/magick.wasm` links its libraries statically. The relink kit, which you
need to link `magick` again against your own libheif, libde265
(LGPL-3.0-or-later) or GNU libiconv (LGPL-2.1-or-later), or any other of its
libraries, is a separate package on the same registry:
[`@ai-ecoverse/wasm-imagemagick-relink`](https://github.com/ai-ecoverse/homescoop/tree/main/packages/imagemagick-relink),
at the same version as this package. Its `share/imagemagick-heif/relink/`
holds magick's objects, every static library of the link, the link flags and
`relink.sh`. libheif, libde265 and dav1d come from `@ai-ecoverse/wasm-libheif`
(its `lib/`) or your own build.
With Emscripten 4.0.23:

```bash
npm pack @ai-ecoverse/wasm-imagemagick-relink@<this version> && tar xzf ai-ecoverse-wasm-imagemagick-relink-*.tgz
bash package/share/imagemagick-heif/relink/relink.sh /tmp/relinked /path/to/dir/with/your/libs
cp /tmp/relinked/magick /tmp/relinked/magick.wasm node_modules/@ai-ecoverse/wasm-imagemagick-heif/bin/
```

The kit lives outside this package so that the runtime download stays small
(homescoop#593; 7.1.2-34-2 to -34-4 shipped it in `share/`). The full source
build is
[`packages/imagemagick-heif/build.sh`](https://github.com/ai-ecoverse/homescoop/tree/main/packages/imagemagick-heif)
and its recipe.
