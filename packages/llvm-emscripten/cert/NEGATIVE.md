# Negative proof (llvm-emscripten)

## 24.0.0-1: a new build input for wasm-clang (homescoop#859 stage E)

**Date:** 2026-10-18. The toolchain-refresh terms (#876, #859).

**Supply chain.**
- Published wasm-clang 24.0.0-21 is a packaging-only repack of 24.0.0-11. That one linked `llvm.wasm` from a local `slicc-emscripten/build/llvm-wasm` tree, which no longer exists: no provenance for its LLVM objects, and `source.sha256: skip`. cert-review's root rule gives that input INCOMPLETE ("unverifiable input").
- llvm-emscripten 24.0.0-1 comes from this recipe, with no stage or prebuilt path:
  - llvm-project `b158b0ae` (GitHub archive, sha256 `8302c5e0…1044`) through `homescoop_fetch`;
  - the native tablegen tools built from that same source;
  - the patched emscripten 6.0.9 tree and emsdk f04ea239's compilers, both pinned by sha256 in `scripts/emscripten-tree.sh`, as wasm-binaryen uses them.

  At this head, `repack-input.mjs --package llvm-emscripten` gives `attested: true`. wasm-clang (stage F) then links this package by sha256.

**Matches what the published wasm-clang was linked from, where that can be compared** (`test/check.mjs`):
- `lib/clang/24` is file for file (sha256) the published wasm-clang 24.0.0-21's resource dir: 298 files, apart from the `lib/` builtins wasm-clang adds from wasix-sysroot.
- `clang --version` is `clang version 24.0.0git (https://github.com/llvm/llvm-project.git b158b0ae6c559f87be325b8f427c5588e6a48823)` with `Target: unknown`, the same as 24.0.0-21. `-print-targets` lists wasm32 and wasm64 only, as published.
- The generated mains initialize LLVM as wasm-clang's `multicall.cpp` already checks: clang with `(true, true)`, the others with the defaults.
- The old build tree is gone, so its library set and objects can't be diffed. Stage F's link will compare `llvm.wasm`'s imports, exports and sizes with 24.0.0-21.

**The check is not vacuous.** `test/check.mjs` on a copy of the package without `lib/libLLVMSupport.a` → FAIL, 12 cases: the manifest's file list, all four links, and every run after them. On the real package it passes. clang -O2 -c, then lld, gives a module that computes add(40, 2) = 42 and mul(6, 7) = 42, and llvm-ar and llvm-nm see `T add` and `T mul`.

## 24.0.0-2: getMainExecutable on Emscripten (patches/0001, homescoop#859 stage F)

`node packages/llvm-emscripten/test/check.mjs --tarball` with the published 24.0.0-1 (local, macOS): **FAIL, 3 checks.**
- manifest.json has no `llvm_patches`.
- `clang.js -### -v` (found through PATH): `InstalledDir: ` (empty) and `"" "-cc1"`.
- `clang.js` run by an absolute path: `InstalledDir: ` (empty).

Every other check passes as before. In slicc-kernel, the same empty main executable makes clang spawn `""`, `clang: error: unable to execute command: posix_spawn failed: No such file or directory` (found by thr_t4h9qnrjas linking wasm-clang). thr_t4h9qnrjas checked this patch in the kernel: Path.cpp compiled with it, using the manifest's multicall flags, and linked ahead of libLLVMSupport.a. With it, wasm-clang's run-cc.mjs (r18 to r28w, users enforce) and its cxx-eh cert pass.

