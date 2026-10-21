# py-numpy pre-stage checklist

The cp315 build (numpy 2.5.4 for wasix-python 3.15). `build.sh` is the source of truth; this lists what it does and what to check.

## Build requirements
- wasi/wasm32 meson cross (numpy's vendored meson, Cython 3.3.0); wasixcc PIC (`sysroot-ehpic`), libc++ headers from the sysroot.
- Python headers from the `wasix_python` source (wasix-python 3.15.0-1), which must match the package's range floor (`>=3.15.0-1 <3.15.1`); `build.sh` fails otherwise.
- **OpenBLAS:** the `wasix_openblas` source, `@ai-ecoverse/wasix-openblas` 0.3.34-1 (static PIC, C LAPACK, f2c int-return ABI), linked with `-Dblas=openblas -Dlapack=openblas`. `numpy-cblas-int-returns.patch` gives numpy's `cblas_[cz]dot[uc]_sub` declarations the same int return. `tools/build-openblas.sh` is the 0.3.28 build that 2.5.4-2 and earlier used; `build.sh` no longer runs it.
- `build.sh` writes its own wasixcc wrappers (`$B/tools/bin/wasix-cc`, `wasix-c++`): `-lopenblas` becomes `--whole-archive`, and every `*.cpython-315-wasm32-wasix.so` link gets `-Wl,--fatal-warnings` (a signature mismatch fails the build).
- `build.sh` also writes `$B/tools/site/sitecustomize.py` on `PYTHONPATH`, so the host python reports the wasix SOABI, EXT_SUFFIX and include dir to meson.
- A stub `install_name_tool`, so meson install works for the wasm `.so` files.
- `bin/numpy-config` and `bin/f2py`: console-script launchers for numpy's `console_scripts` (`#!/usr/bin/env python3`), shipped as `slicc.commands` (homescoop#1405).
- Last step: `homescoop_compile_pyc` (`unchecked-hash`).

## Hard checks
1. SOABI `cpython-315-wasm32-wasix` (no macosx/darwin): the side modules are `*.cpython-315-wasm32-wasix.so`.
2. `NPY_SIZEOF_LONG` / `NPY_SIZEOF_INTP` = 4 (`build.sh` greps `_numpyconfig.h`).
3. `node tools/unresolved.mjs` → 0 (include `python.wasm`).
4. **`tools/mismatch.mjs` → 0**, and `packages/py-kiwisolver/test/wasm-call-signatures.mjs` → 0 (both run in `build.sh`). Any `signature_mismatch:` stub is an `unreachable` trap at runtime.
5. `.pyc` count ≈ `.py` count.
6. `np.show_config()` reports openblas; `cblas_dgemm` / `dgesdd_` / `dgeev_` are **defined** in `_multiarray_umath` and `_umath_linalg`.
7. The certs in `cert/` pass (`cert/meta.json` lists them), and `test/py-vs-sdist.mjs` matches the sdist.
