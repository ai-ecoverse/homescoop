# `@ai-ecoverse/wasm-magick-native`

Magick.Native **2026.824.1923** (Q8, no HDRI) for WebAssembly / emscripten.
This is the native side magick-wasm loads (`MagickNativex86`), not the
`magick` CLI in `@ai-ecoverse/wasm-imagemagick`.

Do not depend on an uncertified tarball.

## What SLICC loads

| | |
| --- | --- |
| Glue | `magick.js` (also `x86/magick.js`) |
| Wasm | `magick.wasm` |
| Factory | `MagickNativex86` (`MODULARIZE=1`, `EXPORT_ES6=1`) |
| Runtime | `FS`, `addFunction`, `HEAPU8`, UTF8 helpers; `_malloc` / `_free` |
| Config | `MAGICK_CONFIGURE_PATH` → `etc/ImageMagick-7` when present |

Instantiate with `locateFile` / `wasmBinary` pointing at `magick.wasm`.
There is no CLI `slicc.commands` entry — the surface is the Magick.Native
C API (MagickImage_Create / Read / Write / …) that
`@dlemstra/magick-wasm` wraps.

## Cert checklist

Same as wasm-imagemagick, through Magick.Native rather than `magick`:

- PNG create / resize / identify
- PNG → LZW TIFF → PNG, AE 0
- ICC sRGB-v4 → Display P3 on red ≈ (91.75%, 20.00%, 13.85%)
- Delegates: jpeg png tiff lcms (plus webp/openjpeg/freetype/xml as linked)

Native-specific:

- Module factory is `MagickNativex86`, not `callMain`
- Quantum Q8 (`MAGICKCORE_QUANTUM_DEPTH=8`, HDRI off)
- `x86/` layout matches `@dlemstra/magick-native/x86`
