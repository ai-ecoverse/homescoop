# py-pillow PRESTAGE

Since 12.3.0-9 the package is built from the sdist by `build.sh` in CI. It links libjpeg-turbo and FreeType statically into the PIC side modules, and leaves zlib unresolved; `python.wasm` exports it. `build.sh` runs py-kiwisolver's `test/wasm-call-signatures.mjs` over every `.so` and fails on any mismatch.
