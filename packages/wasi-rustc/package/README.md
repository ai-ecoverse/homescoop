# @ai-ecoverse/wasi-rustc

`rustc` 1.98.1 (LLVM-in-wasm) for **slicc**. Host: `wasm32-wasip1-threads`.
Default compile target: **wasm32-wasip1**.

- `rustc --version`, `rustc -vV` (LLVM 21.1.8), `rustc hello.rs -o hello.wasm`,
  `-O`, `std::fs` / `std::env` / `std::process::exit`, `--extern` crates.
- Linker: LLD inside `rustc.wasm` (no separate `rust-lld`).
- Proc macros run as child processes (WASIX `proc_spawn3`), so derives work
  under `@ai-ecoverse/wasi-cargo`.
- Compile errors exit with status 1.

Built by homescoop's ladder from `rustc-1.98.1-src.tar.xz` with the patches in
the recipe, against `@ai-ecoverse/wasi-llvm` 21.1.8 and wasi-sdk 34.

## Layout

- `bin/rustc`: shell driver (adds `--sysroot` and `--target`, keeps PATH)
- `bin/rustc.wasm`: the compiler (wasip1-threads host), without its `name`
  section; `@ai-ecoverse/wasi-rustc-names` has the function names for
  `SLICC_WASM_BACKTRACE`
- `lib/rustlib/wasm32-wasip1/`: std/core/alloc and the self-contained crt

## Environment

- `RUST_MIN_STACK=16777216` (set by the package: LLVM needs a large stack)

## LTO

`-C lto=fat` and `-C lto=thin` (Cargo's `lto = true` / `"fat"` / `"thin"`) aren't available: rustc.wasm's LLVM (wasi-llvm 21) can't read the standard library's bitcode, which Rust's LLVM 22 wrote, so rustc says so and stops (homescoop#1237). An rlib with `-C lto` builds as
before: it reads no upstream bitcode (1.98.1-9, homescoop#1464). The refusal
comes before any output is written, so a refused build (say `--crate-type
rlib,cdylib`) leaves nothing behind (1.98.1-10, homescoop#1543). Local
ThinLTO, the default, works.

