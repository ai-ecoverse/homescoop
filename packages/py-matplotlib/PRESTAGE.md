# py-matplotlib 3.11.2-2 PRESTAGE

## Build
- wasixcc PIC; `system-freetype=true` against **wasixcc-built PIC** `libfreetype.a` (static into `ft2font`)
- `macosx=false`, `rcParams-backend=Agg`, `b_lto=false`, `HB_NO_MMAP` + `mprotect` stub
- No `@ai-ecoverse/wasm-*` runtime dependencies

## Checklist (required)
1. **SOABI** only `*.cpython-314-wasm32-wasix.so` (no Darwin rename)
2. **Top-level ctypes** clean on Agg path
3. **`.pyc`** shipped (unchecked-hash)
4. **`unresolved.mjs` against staged file set only** — every `env` function import resolves:
   ```bash
   node unresolved.mjs \
     <staged wasix-python>/bin/python.wasm \
     $(find <staged py-matplotlib> <staged py-* deps> -name '*.so')
   ```
   Must print `0 unresolved`. Do **not** count build-tree `.a` files that are not shipped.
5. **No runtime dependency** is a package without a `.so` / `.wasm` (do not depend on wasm-freetype/jpeg/png/zlib as runtime packages — they are build inputs only)

## Companion
- `py-pillow@12.3.0-2`: static PIC `libjpeg.a` + `libfreetype.a`; zlib from `python.wasm`
