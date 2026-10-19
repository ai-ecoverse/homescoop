# `@ai-ecoverse/py-scipy`

SciPy **1.18.1** for slicc WASIX CPython 3.14 (`cp314-wasix_wasm32`): 95 `dylink.0` side modules that `python.wasm` loads by `dlopen`.

- **Build:** in homescoop's CI from the PyPI sdist, with meson, Cython and numpy's f2py on the build machine. It uses wasixcc PIC side modules (`sysroot-ehpic`, legacy EH) against `@ai-ecoverse/wasix-python` 3.14.2-28 and `@ai-ecoverse/py-numpy` 2.3.2-12, with wasix-sysroot 2025.9.30-38.
- **BLAS/LAPACK:** `@ai-ecoverse/wasix-openblas` 0.3.28-1 (OpenBLAS with its C LAPACK), linked statically into the side modules that call it. Every module links with `-Wl,--fatal-warnings`, so a wasm call signature mismatch fails the build.
- **No Fortran:** scipy 1.18 builds without a Fortran compiler. The one casualty is `scipy.odr`, deprecated upstream, which isn't included.
- **Python range:** `>=3.14.2-28 <3.14.3`, with py-numpy `>=2.3.2-12 <2.3.3`.

## Since 1.18.1-1

- **Source build:** built from source in CI (homescoop#211). Up to 1.18.0-12 the package was a repack of a local build that shipped a shared `scipy/.libs/libscipy_openblas.so`.
- **uarray (homescoop#589):** `scipy._lib._uarray`'s `_Function` getters (`domain`, `arg_extractor`, `arg_replacer`, `default`) and the `_pickle` methods no longer end python with `wasm trap: function signature mismatch`.
