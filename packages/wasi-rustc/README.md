# @ai-ecoverse/wasi-rustc

`rustc` (LLVM-in-wasm) for **slicc**. Host: `wasm32-wasip1-threads`.
Default compile target: **wasm32-wasip1**.

## Patched cut `1.83.0-2`

- Works: `rustc --version`, `rustc hello.rs` → `hello.wasm`, `-O`,
  `std::fs` / `env` / `process::exit`
- Linker: **rust-lld** (bundled). Next: spawn `wasm-ld` from
  `@ai-ecoverse/wasm-clang` over WASIX (`-C linker=wasm-ld` in target spec).
- PATH reaches rustc.wasm. The host std patch supports PATH splitting, TMPDIR,
  and HOME; bundled rust-lld links quietly.
- Cargo: deferred
- Provenance: the pinned Rust 1.83 fork, built with in-tree `x.py` by
  `.github/workflows/wasi-rustc-patched.yml`, plus two local patches in `patches/`.

## Layout

- `bin/rustc` — shell driver (injects `--sysroot` + `--target`, preserves PATH)
- `bin/rustc.wasm` — compiler (wasip1-threads host)
- `lib/rustlib/wasm32-wasip1/` — std/core/alloc + self-contained crt

## Environment

- `RUST_MIN_STACK=16777216` recommended (large LLVM stack)
- Run dep: `@ai-ecoverse/wasm-clang` (for upcoming wasm-ld spawn)

## Sizes (this cut)

See SPIKE.md / publish report.

## Stage from CI

Download the `wasi-rustc-patched` artifact from the workflow, then run
`python3 packages/wasi-rustc/stage-patched.py <wasi-rustc-patched.tgz>`.
The script stages only the compiler and `wasm32-wasip1` rustlib, excluding
the Linux host rustlib and duplicate debug copy. `build.sh` remains the
historical 1.83.0-1 spike recipe.
