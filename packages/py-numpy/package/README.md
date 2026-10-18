# `@ai-ecoverse/py-numpy`

NumPy **2.3.2** for slicc WASIX CPython 3.14 (`cp314-wasix_wasm32` side modules).

- Built with wasixcc PIC (`sysroot-ehpic`); SOABI `cpython-314-wasm32-wasix`
- **OpenBLAS 0.3.28** (`NOFORTRAN=1`, `RISCV64_GENERIC`, f2c netlib, **int ABI**)
  statically linked into `_multiarray_umath` and `_umath_linalg`
- Zero `signature_mismatch` stubs (`mismatch.mjs`); links use `-Wl,--fatal-warnings`
- `.pyc` precompiled (`unchecked-hash`)
## Since 2.3.2-12

`numpy.linalg` raises `LinAlgError` for a singular matrix (`solve`, `inv`, `tensorsolve`, `matrix_power` with a negative power), a non-positive-definite one (`cholesky`), and LAPACK non-convergence (`eig*`, `svd`, `lstsq`, `qr`), as on Linux (homescoop#1082). Up to -11 these returned NaN. The cause is that wasm has no floating-point status flags, which numpy uses to report LAPACK's failure. Other FP warnings that come from hardware flags, such as `RuntimeWarning: divide by zero`, still don't appear (homescoop#1081).

