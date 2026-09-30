# `@ai-ecoverse/py-numpy`

NumPy **2.3.2** for slicc WASIX CPython 3.14 (`cp314-wasix_wasm32` side modules).

- Built with wasixcc PIC (`sysroot-ehpic`); SOABI `cpython-314-wasm32-wasix`
- **OpenBLAS 0.3.28** (`NOFORTRAN=1`, `RISCV64_GENERIC`, f2c netlib, **int ABI**)
  statically linked into `_multiarray_umath` and `_umath_linalg`
- Zero `signature_mismatch` stubs (`mismatch.mjs`); links use `-Wl,--fatal-warnings`
- `.pyc` precompiled (`unchecked-hash`)
