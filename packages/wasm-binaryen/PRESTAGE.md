# wasm-binaryen (emscripten ABI)
Relink of slicc-emscripten `build/binaryen-wasm` (objects from 2026-09-22).
Linked CLI objects currently have **no** sigaction/sigset_t layout
(`packages/wasm-binaryen/sig-layout-sources.txt` is empty by design).
`--version` is not a sufficient smoke.

## PRESTAGE
```sh
node scripts/smoke-binaryen.mjs
```
Runs `wasm-opt -O` on a tiny module and requires a valid wasm output plus a
clean shutdown (no `Option … registered more than once`, no runtime trap).
