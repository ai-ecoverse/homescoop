# Negative proof (wasm-emscripten)

## 6.0.9-18: path resolution (#277)

`run-paths.mjs --expect old` against 6.0.9-17 is a `ci` entry: in an npm layout its em-config looks under `/shared/lib/node_modules`, which no package manager fills.

## 6.0.9-19: the companions' glue (homescoop#276, 2026-10-16)

`run-paths.mjs --layout flat` against the published 6.0.9-18 on slicc-kernel 1.61.0 (the cert kernel): FAIL, with `clang --version (24.0.0-12): rc=70`. The wasm-clang that 6.0.9-18 pins carries slicc-emscripten's unguarded Node-host runner, which runs a second main with no arguments wherever the worker exposes `process`, as kernels before 1.93.0 do. 6.0.9-19 pins wasm-clang 24.0.0-18 and wasm-binaryen 132.0.0-2 (#610, #693), whose glue stays out of a host that sets `noInitialRun`. Both `--version` calls exit 0 with nothing on stderr.
