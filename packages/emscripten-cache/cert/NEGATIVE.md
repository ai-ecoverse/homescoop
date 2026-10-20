# Negative proof (emscripten-cache)

**Date:** 2026-10-17, for 6.0.9-4, the package's first cert (homescoop#426, #859). Run with `node packages/emscripten-cache/cert/check.mjs`, darwin-arm64.

## Supply chain
6.0.9-3 was an rsync of a local `slicc-emscripten/cache/sysroot`, with no provenance and no recorded inputs. Its `sanity.txt` named emsdk 4.0.23's LLVM, and its DWARF names `/Users/trieloff/Developer/ai-ecoverse/slicc-emscripten/cache/...`. 6.0.9-4 is `embuilder build` of `libs.txt` in CI, from the emscripten 6.0.9 tag (fetched by sha256) with `packages/wasm-emscripten/patches`, on emsdk 6.0.9's prebuilt clang and binaryen. That's the same tree as wasm-emscripten 6.0.9-20.

## The published 6.0.9-3 fails check.mjs
It fails first on the build-path row:

```text
AssertionError: libraries name a build path in their DWARF (patch 0011 maps the cache and the llvm root): libGL-getprocaddr: /Users/trieloff/Developer/ai-ecoverse/slicc-emscripten/cache/sysroot/include | libGL: /Users/trieloff/Developer/ai-ecoverse/slicc-emscripten/cache/sysroot
```

Without that row, it fails on the next one. Its headers come from the 6.0.9 tree, but its `libc.a` doesn't:

```text
wasm-ld: error: …/newer.o: undefined symbol: epoll_create1
wasm-ld: error: …/newer.o: undefined symbol: ppoll
AssertionError: libc.a has what the 6.0.9 headers declare: epoll_create1 and ppoll link
```

Comparing the two `libc.a`, 6.0.9-4 defines 58 symbols that 6.0.9-3 lacks, among them epoll_*, ppoll, posix_getdents, getpass, pthread_kill and the pthread_*attr_* functions. 6.0.9-3 has 12 that the 6.0.9 tree dropped, among them `__syscall_poll` and `emscripten_set_thread_name`. libc++, libc++abi, libunwind, libsockets, libstubs and crt1 define the same symbol sets in both. The file list is identical: the same 50 libraries, the same headers, `share/` and `bin/`. The only header difference is the comment above sigset_t in alltypes.h (patch 0007's wording).

## Reproducibility
The first CI run of #1016 failed `reproducible`: host-build and rebuild differed in 45 of the 50 libraries. Emscripten maps its own source dir to `/emsdk/emscripten` in DWARF, but not the cache's `sysroot/include` or clang's resource headers, and both live under the build's work dir. wasm-emscripten patch 0011 maps them to `/emsdk/cache` and `/emsdk/llvm`. Two local builds in different work dirs then gave byte-identical tarballs, and no library names a build path. check.mjs keeps that row: no library may contain `/home/`, `/Users/`, `/__w/` or `/private/var/`.

## 6.0.9-5: republishes the CI build (homescoop#1328; 2026-10-20)
6.0.9-5 is a packaging bump. The slicc shim isn't in it: embuilder builds libc.a from upstream emscripten, and wasm-emscripten's link.py links the shim objects. On #1264, emscripten-cache came into the cone through its recipe `inputs` (wasm-emscripten's package.json, bumped there to 6.0.9-24).

npm's 6.0.9-4 differs from the current CI build in `sysroot/lib/wasm32-emscripten/libc.a` and `libc-debug.a`, though the CI build is reproducible (host-build and rebuild are byte-identical). The only difference is two archive member names: npm has `_Exit__1.o` and `_exit.o` where the CI build has `_Exit.o` and `_exit__1.o`. The object code is the same. The cause is `system_libs.py`'s case-insensitive basename dedup, which follows the source order. The digests are in #1328. cert/check.mjs certifies the CI build as usual.
