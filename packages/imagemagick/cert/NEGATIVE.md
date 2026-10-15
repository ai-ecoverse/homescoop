# Negative: wasm-imagemagick 7.1.2-32-3

7.1.2-32-3 fails `checklist.mjs` at its first assertion: `magick -version` lists only `jng jp2 jpeg lcms png tiff` as built-in delegates, with no freetype, webp, xml or zlib. The `.pc` files that `homescoop_ensure_prefix_pcs` synthesized for wasm-zlib, wasm-libwebp and wasm-freetype said `Version: 0`, so configure's `libwebp >= 0.4.1` and `freetype2 >= 2.8.0` checks failed, and -2/-3 configured `--without-xml`.
