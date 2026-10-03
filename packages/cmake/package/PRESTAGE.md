# cmake (emscripten ABI)
Not linked against wasix-libc; F_SETFD wasix fix N/A.
Relink of slicc-emscripten `build/cmake-wasm-build` (objects from 2026-09-24).
`build.sh` recompiles the sigaction/sigset_t layout allowlist before link
(`packages/cmake/sig-layout-sources.txt`). `--version` is not a sufficient smoke.

## PRESTAGE
```sh
node scripts/smoke-cmake.mjs
```
That runs `cmake -E echo`, `cmake -E sha256sum`, `cmake -P`, and a Unix Makefiles
configure (`CMAKE_MAKE_PROGRAM` stubbed so the host need not have GNU make).
Must exit 0 with no `Option … registered more than once` and no trap at shutdown.
