# @ai-ecoverse/wasi-rustc

`rustc` (LLVM-in-wasm) for **slicc**. Host: `wasm32-wasip1-threads`.
Default compile target: **wasm32-wasip1**.

## Patched cut `1.83.0-2`

- Works: `rustc --version`, `rustc hello.rs` → `hello.wasm`, `-O`,
  `std::fs` / `env` / `process::exit`
- Linker: **rust-lld** (bundled). Next: spawn `wasm-ld` from
  `@ai-ecoverse/wasm-clang` over WASIX (`-C linker=wasm-ld` in target spec).
- PATH is passed through to the compiler. The WASI host std supports PATH
  splitting, TMPDIR and HOME in this build. The bundled rust-lld links quietly.
- Cargo: deferred
- Provenance: Rust 1.83 at the pinned compile-for-wasm fork commit, rebuilt by
  in-tree `x.py` with the host std and quiet-link patches in homescoop.

## Layout

- `bin/rustc` — shell driver (injects `--sysroot` + `--target`, preserves PATH)
- `bin/rustc.wasm` — compiler (wasip1-threads host)
- `lib/rustlib/wasm32-wasip1/` — std/core/alloc + self-contained crt

## Environment

- `RUST_MIN_STACK=16777216` recommended (large LLVM stack)
- Run dep: `@ai-ecoverse/wasm-clang` (for upcoming wasm-ld spawn)

## Sizes (this cut)

See SPIKE.md / publish report.
