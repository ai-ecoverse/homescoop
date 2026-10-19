# wasm-clang (emscripten ABI)

Built in CI from `@ai-ecoverse/llvm-emscripten` (homescoop#859 stage E, fetched by sha256). build.sh links the six tools and `multicall.cpp` into `bin/llvm.wasm` with the patched emscripten 6.0.9 tree (`scripts/emscripten-tree.sh`), against today's `shims/slicc`.

## PRESTAGE
build.sh checks:
- Every alias glue is a byte-copy of `bin/llvm`, and each one's `--version` reaches its tool.
- Under node, clang `-mllvm … -c` produces an object, `llvm-ar rcs` archives it, `llvm-nm` lists `T smoke_add`, `llvm-objcopy --strip-all` rewrites it, and `wasm-ld` links a module that exports `smoke_add`.
- `llvm.wasm` names no build path, and its glue carries the guarded Node-host runner and `slicc_cred_js`.
- `bin/` holds only `llvm.wasm` (no wasm-opt).
