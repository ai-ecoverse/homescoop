# `@ai-ecoverse/wasm-cmake`

CMake 4.4.3 for slicc's wasm realm (relinked with `homescoop_em_cli_ldflags`
+ libslicc spawn profile). Honors `CMAKE_ROOT` (manifest default:
`${package}/share/cmake-4.4`) so modules resolve when argv0 is `/usr/bin/cmake`.

```bash
ipk add -g @ai-ecoverse/wasm-cmake
cmake -E echo hello
cmake -P script.cmake
```
