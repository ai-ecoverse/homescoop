# @ai-ecoverse/wasm-binaryen

Binaryen **132** CLI tools for the slicc wasm realm. Relinked with current
libslicc (`Module.sliccKernel` spawn) + `ENVIRONMENT=web,worker,node`.

Ships the Emscripten-facing tool set:

`wasm-opt`, `wasm-metadce`, `wasm-emscripten-finalize`, `wasm-ctor-eval`,
`wasm-split`, `wasm2js`, `wasm-as`, `wasm-dis`.

Used by `@ai-ecoverse/wasm-emscripten` (as `BINARYEN_ROOT`) and by
`@ai-ecoverse/wasm-clang` drivers for fork Asyncify (`wasm-opt --asyncify`).

## Environment

Every tool links homescoop's `shims/slicc/slicc-env.js`: its environment is
only what the kernel passes, with none of Emscripten's placeholders
(`USER=web_user`, `LOGNAME=web_user`, `HOME=/home/web_user`, `PATH=/`). After
`env -i`, a tool sees an empty environment.

## Emscripten runtime

The tools are linked with the same patched Emscripten 6.0.9 tree as
`@ai-ecoverse/wasm-emscripten`, including its package patches: the
JavaScript file system follows up to 40 consecutive symlinks (`SYMLOOP_MAX`),
not 39.

## Licences

`LICENSE` is Binaryen's. `THIRD-PARTY-NOTICES.md` covers the Emscripten
runtime, FP16 (MIT) and homescoop's own slicc shims (Apache-2.0).
