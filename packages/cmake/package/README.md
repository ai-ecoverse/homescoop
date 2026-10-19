# `@ai-ecoverse/wasm-cmake`

CMake 4.4.3 for slicc's wasm realm, built in CI from the release tarball with
the patched emscripten 6.0.9 tree and linked against libslicc (spawn,
select/poll for libuv, signals, kernel credentials). Honors `CMAKE_ROOT` (manifest default:
`${package}/share/cmake-4.4`) so modules resolve when argv0 is `/usr/bin/cmake`.

```bash
pnpm add -g @ai-ecoverse/wasm-cmake
cmake -E echo hello
cmake -P script.cmake
```
