# @ai-ecoverse/wasix-openblas

[OpenBLAS](http://www.openblas.net/) 0.3.34 compiled for wasm32-wasix by
homescoop's ladder: a **build input** (no commands) that py-numpy and
py-scipy link, fetched by sha256, so OpenBLAS is built once.

- `lib/libopenblas.a`: static and **PIC** (the ehpic tree's legacy wasm
  exceptions, as numpy's and scipy's side modules; OpenBLAS is C, so the
  objects carry no EH code). BLAS, CBLAS and LAPACK (OpenBLAS's C
  translation of netlib, `NOFORTRAN=1`). Link it whole (`--whole-archive`)
  into a side module, or let wasm-ld pull what a program needs.
- `include/`: `cblas.h`, `f77blas.h`, `openblas_config.h`.
- `lib/pkgconfig/openblas.pc` (and `blas.pc`, `lapack.pc`, `cblas.pc`), with
  a prefix relative to the .pc file. meson finds it with
  `-Dblas=openblas -Dlapack=openblas`. It carries
  `openblas_config=USE_THREAD=0 NO_LAPACKE NO_AFFINITY RISCV64_GENERIC INT_ABI`.

Built as `TARGET=RISCV64_GENERIC BINARY=32 NOFORTRAN=1 USE_THREAD=0
NO_SHARED=1 NO_LAPACKE=1 NO_AFFINITY=1` with wasixcc on wasix-sysroot
2025.9.30-38, after Pyodide:

- **The f2c int ABI:** every Fortran-style BLAS/LAPACK entry returns `int`, as
  f2c'd code expects (`cblas_*` too). Caller and callee must agree, because
  wasm-ld links a trapping stub for a signature mismatch.
- **`xerbla_`** takes `(char *, int *)` and is **weak**, as is `xerbla_array_`,
  so a program's own definition wins (numpy's `python_xerbla`, scipy's
  `xerbla_array_`).
- LAPACK's test-matrix generators (tmglib) aren't in the archive.

BSD-3-Clause (OpenBLAS, LAPACK) and BSD-2-Clause (GotoBLAS2); see `LICENSE`
and `THIRD-PARTY-NOTICES.md`.
