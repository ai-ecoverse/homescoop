# @ai-ecoverse/wasi-zig (with LLVM 21)

Zig 0.16.0 for slicc, built for wasm32-wasi with LLVM 21.1.8, clang and lld.

- `zig build-exe` / `run` / `test` / `build`, `-ofmt=c`, all optimize modes,
  with LLVM's optimizer for ReleaseFast / ReleaseSmall / ReleaseSafe.
- `zig cc` / `zig c++` for wasm32-wasi. wasi-libc, libc++ and Zig's runtimes
  (compiler_rt, ubsan_rt, zigc) ship prebuilt for the baseline CPU; another
  CPU or mode (e.g. `-mcpu=generic+simd128`) builds wasi-libc from its C
  sources, in the optional `@ai-ecoverse/wasi-zig-libc-src` package
  (`ipk install @ai-ecoverse/wasi-zig-libc-src`).
- Backends: Debug builds of pure-Zig wasm32 code use Zig's self-hosted wasm
  backend (fast compiles, as in the no-LLVM package); Release modes, programs
  that link libc and C/C++ sources use LLVM. `-fllvm` / `-fno-llvm` (or
  `.use_llvm` on a compile step) override that per build.
- Targets: wasm32 / wasm64 only (the LLVM inside has the WebAssembly target);
  clang's resource headers are trimmed to the ones wasm uses.
- Runs with real threads under slicc (LLVM's thread pool, wasi-threads).
- `@cImport` and `zig translate-c` work (since 0.16.0-18, homescoop#1061).
  The first use compiles the translate-c tool into the cache, which takes a
  while.
- `zig c++` for wasm32-wasi compiles with `-fno-exceptions` by default
  (since 0.16.0-18, homescoop#1062): the bundled libc++ has no exception
  support, as with wasi-sdk's clang. Code that throws aborts instead, and
  `-fexceptions` turns them back on (and then fails to link).

LLVM is Apache-2.0 WITH LLVM-exception (LICENSE-LLVM.TXT); Zig is MIT (LICENSE).
