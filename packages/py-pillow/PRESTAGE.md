# py-pillow 12.3.0-2 PRESTAGE

Static PIC link of libjpeg + FreeType into `_imaging` / `_imagingft`.
zlib left unresolved at link (resolved by wasix-python `python.wasm` exports).
No `@ai-ecoverse/wasm-*` runtime deps.

Unresolved check: staged `python.wasm` + all staged py-* `.so` only → must be `0 unresolved`.
