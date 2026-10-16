# Negative proof (wasm-binaryen)

## 132.0.0-2: the glue's Node-host runner (homescoop#276, 2026-10-16)

`node-entry.mjs` against the published 132.0.0-1 on slicc-kernel 1.92.0 (Node entry, users enforce): FAIL at once, with `bin/wasm-opt: the Node-host runner has no noInitialRun guard (homescoop#276)`. With that check switched off and the glue left as shipped, every tool still exits 0 with its version, but the runner runs a second main with no arguments. `wasm-opt --version` prints `warning: no passes specified, not doing any work` and `warning: no output file specified, not emitting output` on stderr, `wasm-metadce --version` prints `Fatal: no graph file provided.`, and `wasm-emscripten-finalize --version` prints `Fatal: Need to specify an infile`. The spec then fails, `wasm-opt --version printed on stderr`.

From slicc-kernel 1.93.0 the kernel's Node lockdown hides `process` from the worker, so the runner can't fire there. wasm-binaryen declares no slicc-kernel floor, and wasm-clang's cc, which drives wasm-opt, declares 1.44.0. 132.0.0-2 passes on 1.92.0 and on 1.100.4.
