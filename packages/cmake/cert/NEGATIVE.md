# Negative proof (cmake)

**Date:** 2026-10-19, for 4.4.3-10, the package's first cert (homescoop#426, #859 stage G). Run with `node scripts/browser-cert/run.mjs --package cmake --users enforce` on slicc-kernel 1.110.7, darwin-arm64.

## Supply chain
4.4.3-9 relinked objects from a local `slicc-emscripten/build/cmake-wasm-build` (2026-09-24). That build had no provenance, and its libuv and CMAKE_ROOT patches only lived in that checkout. `repack-input.mjs` reports it as unattested: "can take a tree outside the repo ($ROOT/..)" and "never fetches the pinned source". 4.4.3-10 fetches the cmake 4.4.3 release tarball by sha256 and applies three patches, all now in `packages/cmake/`:
- `libuv-emscripten.patch` re-derives the libuv port. libuv has no Emscripten platform: it now gets the posix poll backend and no thread names. `uv_spawn` starts children through `slicc_spawn_capture`, because the realm has no fork. Without that, `execute_process` fails with "function not implemented".
- `cmake-root-env.patch` makes CMAKE_ROOT from the environment win over the executable's install tree.
- `host-emscripten-is-wasi.patch` makes CMakeDetermineSystem map the Emscripten host to WASI.

The build itself is emcmake from the patched emscripten 6.0.9 tree, linked against today's `shims/slicc`.

## The published 4.4.3-9 fails cert/cmake.mjs
```text
AssertionError: cmake.wasm does not import slicc_cred_js (today's shims/slicc)
```
-9's `-E`, `-P`/`execute_process`, configure and gmake build rows pass. Its shims predate the credential library (#459) and the inherited-ignore seed (#973), so its glue names neither `slicc_cred_js` nor `slicc_sig_inherited_js`. 4.4.3-10 passes every row.
