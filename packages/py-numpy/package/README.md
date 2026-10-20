# `@ai-ecoverse/py-numpy`

NumPy **2.5.4** for slicc WASIX CPython 3.15 (`cp315-wasix_wasm32` side modules). Since the Python 3.15 flip (homescoop#761) this is `latest`; the cp314 builds stay on npm by exact version ([release notes](https://github.com/ai-ecoverse/homescoop/blob/main/docs/release-notes/python-3.15.md)).

- **Build:** in homescoop's CI from the PyPI sdist, with Cython 3.3.0 and numpy's vendored meson, using wasixcc PIC side modules (`sysroot-ehpic`, wasix-sysroot 2025.9.30-38). The C++ headers are the sysroot's.
- **OpenBLAS:** `@ai-ecoverse/wasix-openblas` 0.3.34-1, linked statically into `_multiarray_umath`, `_umath_linalg` and `lapack_lite` (OpenBLAS with its C LAPACK, single-threaded). Since 2.5.4-3; before, a 0.3.28 build inside this package.
- **Python range:** `>=3.15.0-1 <3.15.1`.
- **`numpy.linalg`:** raises `LinAlgError` for a failed factorisation (homescoop#1082).
- **Notices:** `THIRD-PARTY-NOTICES.md` carries OpenBLAS's, LAPACK's and GotoBLAS2's licences and those of the code numpy vendors (libdivide, pocketfft, Highway, the `numpy.random` generators).

## On wasm32

- **The default integer is int32** (homescoop#1093). wasm32 is a 32-bit platform, so `np.intp` is 4 bytes and `np.arange(3)` or `np.array([1])` are `int32` (desktop: `int64`). Their sums wrap at 2**31, and a CSV round trip in pandas comes back as `int64`. Pass `dtype=np.int64` where it matters.
- **No floating-point error reporting** (homescoop#1081). WebAssembly has no FP status flags, so `1.0/0`, `np.sqrt(-1)` and overflows give the right `inf`/`nan` but no `RuntimeWarning`, and `np.errstate(all="raise")` doesn't raise `FloatingPointError`. `np.linalg` still raises `LinAlgError`.
