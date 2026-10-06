# wasm-clang 24.0.0-10

- **One multi-call module**: `bin/llvm.wasm` holds clang, lld, llvm-ar, llvm-nm,
  llvm-objcopy and llvm-symbolizer, linked from the per-tool objects, with
  `multicall.cpp`'s main choosing the tool by argv[0] (`llvm <tool>` works too).
  Each tool initializes LLVM as its generated driver does (clang: POSIX-utility
  signals + SIGPIPE handler); build.sh checks that against the generated mains.
  - wasm 104.6 MB (clang + lld) + 18.7 MB (ar/nm/objcopy/symbolizer) → 74.8 MB;
    package 133.1 → 84.9 MB unpacked, tarball 42.4 → 25.8 MB.
- Glue **files** under every LLVM_ROOT name emcc spawns (`clang`, `clang++`, `lld`,
  `wasm-ld`, `ld.lld`, `llvm-ar`, `llvm-ranlib`, `llvm-nm`, `llvm-objcopy`,
  `llvm-strip`, `llvm-symbolizer`) are byte-copies of `bin/llvm`, which locates
  `llvm.wasm`. `slicc.commands` adds `ar`, `ranlib`, `nm`, `strip`.
- **Signal ABI**: slicc-emscripten's musl `sigset_t` is 128 bytes (struct sigaction
  140) since 2026-10-01; build/llvm-wasm was compiled against the 16-byte one. The
  four LLVM sources that lay those structs out (Signals, Process, Program,
  CrashRecoveryContext) are recompiled against the current sysroot (no PCH) and
  linked ahead of libLLVMSupport.a. Without that, any relink corrupts memory
  (trap in llvm_shutdown, "Option 'debug-counter' registered more than once").
  build.sh fails if another source starts using those structs.
- PRESTAGE: every alias `--version` reaches its tool; clang `-mllvm … -c` →
  llvm-ar → llvm-nm smoke under node.
- Unsupported / not shipped: `llvm-dwarfdump`, `llvm-dwp`, `clang-scan-deps`,
  `llvm-profdata`, `llvm-cov`, `llvm-size`, `llvm-cxxfilt`.
- Depends on `@ai-ecoverse/wasm-binaryen@132.0.0-1`, `wasix-sysroot@^2025.9.30-10`.
- `@ai-ecoverse/wasm-emscripten` 6.0.9-10 pins `wasm-clang` 24.0.0-9 exactly;
  bump that pin for emcc users to get this one.
