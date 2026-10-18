# @ai-ecoverse/llvm-emscripten

LLVM, clang and lld 24 (llvm-project `b158b0ae`, emsdk 6.0.9's LLVM revision)
compiled by homescoop's ladder **with emscripten 6.0.9** into wasm objects and
static libraries. This isn't a command package: it's the build input
`@ai-ecoverse/wasm-clang` links into its multi-call `llvm.wasm`, fetched by
sha256, so wasm-clang's root is attested.

- `lib/*.a`: every static library the link edges of clang, lld, llvm-ar,
  llvm-nm, llvm-objcopy and llvm-symbolizer use.
- `objects/`: those tools' own objects, without their generated `main`s.
- `drivers/<tool>-driver.cpp`: the generated mains, for reference.
- `include/`: LLVM's headers and the build's generated `llvm/Config`, enough to
  compile a multi-call `main` against `llvm/Support/InitLLVM.h`.
- `lib/clang/24/`: clang's resource headers.
- `manifest.json`: per tool, its objects, libraries, system libraries and link
  flags; the compile flags for a multi-call main; the configuration
  (Release, WebAssembly only, no threads, no EH, no RTTI, no LTO, `-g0`); the
  emscripten tag, the emsdk release and the sha256 of the wasm-emscripten
  patch set the objects were compiled with.

One source patch (`patches/0001`, since 24.0.0-2; listed by sha256 in
`manifest.json`'s `llvm_patches`): on Emscripten, `sys::fs::getMainExecutable`
resolves `argv[0]`, through `PATH` when it has no slash, as on OpenBSD and
Haiku. Up to 24.0.0-1 it returned `""` there, so clang had an empty
`InstalledDir` and spawned `"" -cc1`, which slicc-kernel refuses
(`posix_spawn failed: No such file or directory`).

Link it with the same emscripten tree (`scripts/emscripten-tree.sh` in
homescoop) and Emscripten JS exceptions (`-fexceptions
-sDISABLE_EXCEPTION_CATCHING=0` at link), as wasm-clang does.

Apache-2.0 WITH LLVM-exception; see `LICENSE`.
