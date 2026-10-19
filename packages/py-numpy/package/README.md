# `@ai-ecoverse/py-numpy`

NumPy **2.5.4** for slicc WASIX CPython 3.15 (`cp315-wasix_wasm32` side modules). Since the Python 3.15 flip (homescoop#761) this is `latest`; the cp314 builds stay on npm by exact version ([release notes](https://github.com/ai-ecoverse/homescoop/blob/main/docs/release-notes/python-3.15.md)).

- **Build:** in homescoop's CI from the PyPI sdist, with Cython 3.3.0 and numpy's vendored meson, using wasixcc PIC side modules (`sysroot-ehpic`, wasix-sysroot 2025.9.30-38). The C++ headers are the sysroot's.
- **OpenBLAS:** 0.3.28, linked statically into `_multiarray_umath`, `_umath_linalg` and `lapack_lite` (f2c LAPACK, single-threaded).
- **Python range:** `>=3.15.0-1 <3.15.1`.
- **`numpy.linalg`:** raises `LinAlgError` for a failed factorisation (homescoop#1082). Other FP warnings that need hardware flags (divide by zero) don't appear on wasm (homescoop#1081).
