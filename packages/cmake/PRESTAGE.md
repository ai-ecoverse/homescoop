# cmake (emscripten ABI)
Not linked against wasix-libc; F_SETFD wasix fix N/A.
Rebuilt in the wasix-sysroot 2025.9.30-14 sweep.

## PRESTAGE
```sh
node scripts/smoke-cmake.mjs
# and:
SMOKE_WORKDIR=$TMP SMOKE_ENV=CMAKE_ROOT=$PWD/packages/cmake/package/share/cmake-4.4 \
  node scripts/run-wasm-cli.mjs packages/cmake/package/bin/cmake -- --version
```
