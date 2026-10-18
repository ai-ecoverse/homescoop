# Negative proof (wasix-openblas)

## 0.3.28-1: a new build input (homescoop A6, 2026-10-18)

There's no earlier wasix-openblas. These are the cases the spec and build.sh refuse, run locally on macOS (wasixcc 0.4.7, wasix-sysroot -38, slicc-kernel 1.124.2 Node entry).

- **The bare-metal libc stubs** (the first local build, before wasm-abi.py dropped them on `__wasi__`): `-DOS_EMBEDDED` makes OpenBLAS's `driver/others/memory.c` define `puts`, `printf`, `getenv` and `atoi` stubs. obprobe's link failed with `wasm-ld: error: duplicate symbol: puts` (and `printf`, `getenv`), defined in `libc.a(puts.o)` and `libopenblas.a(memory.o)`. In a side module that doesn't link libc (numpy's), those stubs instead *replace* libc's, so `printf` and `getenv` silently do nothing there. build.sh now fails if the archive defines any of them.
- **A strong `xerbla_` / `xerbla_array_`:** OpenBLAS makes `xerbla_` a weak alias only on ELF, and the second local build had both strong (`T xerbla_`, `T xerbla_array_`). Linked `--whole-archive` beside numpy's `python_xerbla` or scipy's `xerbla_array_` (wasix_stubs.c), that's a duplicate symbol. build.sh now fails unless both are `W`. obprobe defines its own `xerbla_`, and an illegal `dgemm_` TRANSA reaches it (`xerbla_ DGEMM  1`).
- **An empty `lib/libopenblas.a`:** obprobe doesn't link (undefined `dgemm_`, `cblas_dgemm`, `dgesv_`, …), so cert/probe.mjs can't pass on an archive without BLAS and LAPACK.
