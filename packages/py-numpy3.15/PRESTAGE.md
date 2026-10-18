# py-numpy pre-stage checklist

## Build requirements
- wasi/wasm32 meson cross; wasixcc PIC (`sysroot-ehpic`)
- **OpenBLAS 0.3.28** static PIC build input (`tools/build-openblas.sh`):
  `NOFORTRAN=1`, `TARGET=RISCV64_GENERIC`, plus **`make netlib`** (f2c C LAPACK).
  **One ABI everywhere:** f2c/int returns (Pyodide route). Python patches (not BSD
  `sed -ri`) convert `void foo_` → `int foo_` in interface + lapack-netlib, then
  revert only `c/zdotc|dotu|ladiv`. Align `xerbla_` to numpy's 2-arg form.
  Strip `xerbla*.o` + tmglib (numpy provides `python_xerbla`). Not a runtime npm package.
- Rebuild: `tools/rebuild-with-openblas.sh` (`-Dblas=openblas -Dlapack=openblas`)
  also patches `npy_cblas_base.h` `void BLASNAME` → `int BLASNAME`.
- wasixcc wrapper: `-lopenblas` → `--whole-archive`; real
  `*.cpython-*-wasm32-wasix.so` links get `-Wl,--fatal-warnings` (mismatch = build fail).
- `PYTHONPATH=tools/sitecustomize.py` dir for wasix SOABI
- stub `install_name_tool` so meson install works for wasm `.so`
- Last step: `homescoop_compile_pyc` (`unchecked-hash`)

## Hard checks
1. SOABI `cpython-314-wasm32-wasix` (no macosx/darwin).
2. `NPY_SIZEOF_LONG` / `NPY_SIZEOF_INTP` = 4.
3. `unresolved.mjs` → 0 (include `python.wasm`).
4. **`mismatch.mjs` → 0** (`node tools/mismatch.mjs $(find … -name '*.so')`).
   Any `signature_mismatch:` stub is an `unreachable` trap at runtime.
5. `.pyc` count ≈ `.py` count.
6. `np.show_config()` reports openblas; `cblas_dgemm` / `dgesdd_` / `dgeev_` **defined**
   in `_multiarray_umath` and `_umath_linalg`.
7. Beat published 2.3.2-2 (no BLAS) on `tmp-wasi/live/blastest.py`.
