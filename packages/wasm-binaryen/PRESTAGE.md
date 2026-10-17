# wasm-binaryen (emscripten ABI)

Built from binaryen d03c25ea with emcmake in CI (homescoop#859), and each tool relinked against `shims/slicc` with the credential library.

## PRESTAGE
```sh
node scripts/smoke-binaryen.mjs
```
This runs `wasm-opt -O` on a tiny module. It requires a valid wasm output and a clean shutdown: no `Option … registered more than once`, no runtime trap.
