# `@ai-ecoverse/py-scipy`

SciPy **1.18.0** for slicc WASIX CPython 3.14 (`cp314-wasix_wasm32`).

- wasixcc PIC side modules; SOABI `cpython-314-wasm32-wasix`
- Fortran via hoodmane/f2c; **one shared** `scipy/.libs/libscipy_openblas.so`
  (BLAS/LAPACK extensions NEEDED it with `$ORIGIN/…/.libs` RUNTIME_PATH)
- Extension `.so` paths match the wheel install layout (meson install plan)
- Single int ABI; `-Wl,--fatal-warnings` on real extension links
- `.pyc` precompiled (`unchecked-hash`)
- `scipy.odr` stubbed (ImportError)

- 1.18.0-6 is identical to accepted 1.18.0-5 (npm phantom-stage workaround).
