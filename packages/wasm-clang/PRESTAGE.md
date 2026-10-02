# wasm-clang 24.0.0-9

- Glue **file aliases** for emcc `LLVM_ROOT` path spawn: `clang++`, `wasm-ld`,
  `ld.lld`, `llvm-ranlib`, `llvm-strip` (byte-copies of primary glues; no
  sibling `.wasm` — `locateFile("clang.wasm")` etc. still resolves).
- Unsupported / not shipped: `llvm-dwarfdump`, `llvm-dwp`, `clang-scan-deps`,
  `llvm-profdata`, `llvm-cov`, `llvm-size`, `llvm-cxxfilt`.
- Depends on `@ai-ecoverse/wasm-binaryen@132.0.0-1`, `wasix-sysroot@^2025.9.30-10`.

Deprecated for emcc acceptance: 24.0.0-8 (aliases only via slicc.commands).
