# cmake (emscripten ABI)

Built in CI from the cmake 4.4.3 release tarball with emcmake from the patched emscripten 6.0.9 tree (homescoop#859 stage G), then linked against `shims/slicc`. It is not linked against wasix-libc.

## PRESTAGE
```sh
node scripts/smoke-cmake.mjs
```
This runs `cmake -E echo`, `cmake -E sha256sum`, `cmake -P` and a Unix Makefiles configure. `CMAKE_MAKE_PROGRAM` is stubbed, so the host doesn't need GNU make. It must exit 0, with no `Option … registered more than once` and no trap at shutdown.
