# @ai-ecoverse/wasi-llvm

LLVM 21.1.8, clang and lld built by homescoop as **static libraries for a
`wasm32-wasip1-threads` host**. This isn't a command package: it's the build
input that the LLVM-enabled `@ai-ecoverse/wasi-rustc` and `@ai-ecoverse/wasi-zig`
link. Their homescoop recipes fetch this tarball by sha256, so their builds
take an attested LLVM.

- `lib/`: `libLLVM*.a`, `libclang*.a`, `liblld*.a` (WebAssembly target only;
  threads on, assertions off, no PIC), plus `lib/cmake` and clang's resource
  headers in `lib/clang/21`.
- `include/`: the LLVM, clang and lld headers.
- `bin/llvm-config`: a **python3** script that answers as `llvm-config` would
  (`--version`, `--libs`, `--cxxflags`, `--targets-built`, …). The real one
  would be a wasm program, and consumers run it on the build machine. It finds
  its prefix from its own location.

Built from the upstream `llvm-project-21.1.8.src.tar.xz` (sha256-pinned) with
two documented patches (`patches/` in the recipe), using wasi-sdk 34.0 (the
recipe's `toolchain.wasi-sdk`). Link it with the same wasi-sdk, so libc++ and
wasi-libc agree:

```sh
P=node_modules/@ai-ecoverse/wasi-llvm
"$WASI_SDK_PATH/bin/clang++" --target=wasm32-wasip1-threads -pthread -D_WASI_EMULATED_MMAN \
  $(python3 $P/bin/llvm-config --cxxflags) app.cpp -L$P/lib \
  -llldWasm -llldCommon $(python3 $P/bin/llvm-config --libs --link-static core support webassembly target mc passes option lto) \
  -ldl -lwasi-emulated-mman -Wl,--import-memory,--export-memory -Wl,--max-memory=4294967296
```

lld runs single-threaded (`--threads=1`) where the runtime can't spawn threads.

Apache-2.0 WITH LLVM-exception; see `LICENSE`. `lib/libLLVMSupport.a` also
compiles in Henry Spencer's 4.4BSD regex, BLAKE3 (CC0-1.0 OR Apache-2.0) and
xxHash (BSD-2-Clause). Their notices are in `THIRD-PARTY-NOTICES.md` and, as
files for a program linking these libraries to ship, in
`share/licenses/llvm-support/` (since 21.1.8-2).
