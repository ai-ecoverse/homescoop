# `@ai-ecoverse/wasm-imagemagick`

[ImageMagick](https://imagemagick.org/) 7.1.2-32 `magick` CLI for
[slicc](https://github.com/ai-ecoverse/slicc)'s wasm realm. `convert`,
`identify`, and `mogrify` are argv0 aliases of the same binary.

Delegates: zlib, jpeg, png, tiff, webp, openjpeg, lcms2, freetype, libxml2.

Since 7.1.2-32-4 all of them are linked; 7.1.2-32-3 and older built without
webp, freetype and libxml2 (no WebP, no `-annotate`/TTF, no MSL or internal
SVG renderer), though this list named them. There is no fontconfig and no
bundled font: give text commands a font file with `-font path/to/font.ttf`
(or a Type 1 `.pfb`).
Configure XMLs ship under `etc/ImageMagick-7/`; the slicc manifest sets
`MAGICK_CONFIGURE_PATH` so `colors.xml` / `policy.xml` resolve.

```bash
pnpm add -g @ai-ecoverse/wasm-imagemagick
magick -version
convert logo: out.png
```
