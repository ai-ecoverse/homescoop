# wasm-clang 24.0.0-7

- Depends on `@ai-ecoverse/wasix-sysroot@^2025.9.30-10` (real `lib/wasm32-wasip1`).
- Depends on `@ai-ecoverse/wasm-binaryen@^132-1` for `wasm-opt` (no longer bundled).
- Drivers resolve `wasm-opt` via `WASIXCC_WASM_OPT`, then `PATH`, then legacy `$BINDIR/wasm-opt`.
- Asyncify pass args (Binaryen 132): `--asyncify -O2 --pass-arg=asyncify-imports@wasix_32v1.proc_fork,wasix_32v1.stack_checkpoint,wasix_32v1.stack_restore` plus feature enables matching prior wasix-driver.

Deprecated: 24.0.0-6 (bundled wasm-opt).
