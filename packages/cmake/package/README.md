# `@ai-ecoverse/wasm-cmake`

CMake 4.4.3 for slicc's wasm realm, built in CI from the release tarball with
the patched emscripten 6.0.9 tree and linked against libslicc (spawn,
select/poll for libuv, sockets, signals, kernel credentials). Honors `CMAKE_ROOT` (manifest default:
`${package}/share/cmake-4.4`) so modules resolve when argv0 is `/usr/bin/cmake`.

```bash
pnpm add -g @ai-ecoverse/wasm-cmake
cmake -E echo hello
cmake -P script.cmake
```

## Platform

In slicc the host is **WASI**: `CMAKE_SYSTEM_NAME` is `WASI`, `WASI` is set and
`UNIX` isn't, so `Platform/WASI.cmake` applies and executables are bare `.wasm`
modules that run in slicc's realm (`try_run` works). Pass
`-DCMAKE_SYSTEM_NAME=…` to choose another platform.

## Downloads

`file(DOWNLOAD)` and `FetchContent`/`ExternalProject` with an `http://` URL go
through slicc's network. **`https://` is not supported**: CMake's bundled curl
has no TLS backend in this package, and `file(DOWNLOAD https://…)` returns
`1;"Unsupported protocol"`. Fetch over https with `curl` or `git` first, then
point CMake at the local file or directory (`URL file://…`,
`FETCHCONTENT_SOURCE_DIR_<NAME>`).

## Licences

`LICENSE` is CMake's. `THIRD-PARTY-NOTICES.md` covers the Emscripten runtime
and the libraries CMake bundles and `cmake.wasm` links: curl, libuv,
libarchive, expat, jsoncpp, zstd, bzip2, liblzma, nghttp2, librhash, zlib and
llpkgc.
