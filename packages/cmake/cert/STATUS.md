# cmake — not CI-certified yet

Checklist belongs in `scripts/smoke-cmake.mjs` (`harness: host-node`).  
**Blocked:** `build.sh` expects
`../slicc-emscripten/build/cmake-wasm-build/.../cmakemain.cxx.o`, absent on
ladder-pr runners. Wire a staged artifact or release fetch before enabling
automerge. Renovate #30 stays parked.
