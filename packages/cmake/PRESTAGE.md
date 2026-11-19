# cmake (emscripten ABI)

Built in CI from the cmake release tarball that recipe.yaml pins, with emcmake from the patched emscripten 6.0.9 tree (homescoop#859 stage G), then linked against `shims/slicc`, and against libcurl (Mbed TLS) from wasm-curl and zlib from wasm-zlib instead of CMake's bundled cmcurl and cmzlib (homescoop#1280). It is not linked against wasix-libc.

## PRESTAGE
```sh
node scripts/smoke-cmake.mjs
```
This runs `cmake -E echo`, `cmake -E sha256sum`, `cmake -P` and a Unix Makefiles configure. `CMAKE_MAKE_PROGRAM` is stubbed, so the host doesn't need GNU make. It must exit 0, with no `Option … registered more than once` and no trap at shutdown. `--version` alone is not a sufficient smoke: it passed with a wrong sigaction layout.

The smoke copies `bin/cmake` and `bin/cmake.wasm` alone into `/work/bin`, as slicc runs them from `/usr/bin`, and the module tree to `/work/cmake-root`, which only `CMAKE_ROOT` names. The module tree is the one package.json's `slicc.env.CMAKE_ROOT` names (`${package}/share/cmake-X.Y`, X.Y from recipe.yaml's version), so a new minor series needs no edit here. The configure must write `CMAKE_ROOT:INTERNAL=/work/cmake-root` to the cache.
