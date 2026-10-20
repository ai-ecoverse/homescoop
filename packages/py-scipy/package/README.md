# `@ai-ecoverse/py-scipy`

SciPy **1.18.1** for slicc WASIX CPython 3.15 (`cp315-wasix_wasm32`): 95 `dylink.0` side modules that `python.wasm` loads by `dlopen`. Since the Python 3.15 flip (homescoop#761) this is `latest`; the cp314 builds stay on npm by exact version ([release notes](https://github.com/ai-ecoverse/homescoop/blob/main/docs/release-notes/python-3.15.md)).

- **Build:** in homescoop's CI from the PyPI sdist, with py-scipy's recipe: meson, Cython 3.3.0, and numpy's f2py on the build machine. It uses wasixcc PIC side modules against `@ai-ecoverse/wasix-python` 3.15.0-1 and `@ai-ecoverse/py-numpy` 2.5.4-1, with wasix-sysroot 2025.9.30-38.
- **BLAS/LAPACK:** `@ai-ecoverse/wasix-openblas` 0.3.28-1, linked statically. Every module links with `-Wl,--fatal-warnings`.
- **No Fortran:** `scipy.odr`, deprecated upstream, isn't included.
- **Python range:** `>=3.15.0-1 <3.15.1`, with py-numpy `>=2.5.4-1 <2.5.5`.
