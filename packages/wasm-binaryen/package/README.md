# @ai-ecoverse/wasm-binaryen

Binaryen **132** CLI tools for the slicc wasm realm. Relinked with current
libslicc (`Module.sliccKernel` spawn) + `ENVIRONMENT=web,worker,node`.

Ships the Emscripten-facing tool set:

`wasm-opt`, `wasm-metadce`, `wasm-emscripten-finalize`, `wasm-ctor-eval`,
`wasm-split`, `wasm2js`, `wasm-as`, `wasm-dis`.

Used by `@ai-ecoverse/wasm-emscripten` (as `BINARYEN_ROOT`) and by
`@ai-ecoverse/wasm-clang` drivers for fork Asyncify (`wasm-opt --asyncify`).
