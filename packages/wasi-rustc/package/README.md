# @ai-ecoverse/wasi-rustc

`rustc` (LLVM-in-wasm) for **slicc**. Host: `wasm32-wasip1-threads`.
Default compile target: **wasm32-wasip1**.

## Spike cut `1.83.0-1`

- Works: `rustc --version`, `rustc hello.rs` → `hello.wasm`, `-O`,
  `std::fs` / `env` / `process::exit`
- Linker: **rust-lld** (bundled). Next: spawn `wasm-ld` from
  `@ai-ecoverse/wasm-clang` over WASIX (`-C linker=wasm-ld` in target spec).
- The driver unsets PATH just before launching rustc.wasm to avoid a host std
  panic in this cut. The default bundled rust-lld works without PATH; custom
  linker commands that need PATH are unsupported until the patched rebuild.
- Cargo: deferred
- Provenance: oligamiq/rust_wasm v3.0.0 `rustc_opt.wasm` + `wasm32-wasip1`
  sysroot (bjorn3 `compile_rustc_for_wasm` lineage). In-tree `x.py` replaces this.

## Layout

- `bin/rustc` — shell driver (injects `--sysroot` + `--target`)
- `bin/rustc.wasm` — compiler (wasip1-threads host)
- `lib/rustlib/wasm32-wasip1/` — std/core/alloc + self-contained crt

## Environment

- `RUST_MIN_STACK=16777216` recommended (large LLVM stack)
- Run dep: `@ai-ecoverse/wasm-clang` (for upcoming wasm-ld spawn)

## Sizes (this cut)

See SPIKE.md / publish report.
