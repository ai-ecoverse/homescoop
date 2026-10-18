# `@ai-ecoverse/py-pandas`

Pandas 2.3.2 built as WASIX side modules for `@ai-ecoverse/wasix-python` (CPython 3.14, `cpython-314-wasm32-wasix`).

It takes `@ai-ecoverse/wasix-python` 3.14.2 from revision -27 on and `@ai-ecoverse/py-numpy` 2.3.2 from -11 on (the versions whose headers it's built against; ranges in `package.json`), plus the pure-Python date and tz helpers listed in `package.json`.

## Build (since 2.3.2-12)
- **Source:** built in homescoop's CI from the PyPI sdist, `pandas-2.3.2.tar.gz` (sha256 `ab7b58f8…`). Up to -11 the package was a repack of a local build (homescoop#730).
- **Tools on the host python:** meson 1.9.1 and Cython 3.1.4.
- **Cross build:** a meson cross file (`system='wasi'`, `cpu_family='wasm32'`), compiled with wasixcc as shared-library side modules (`sysroot-ehpic`, legacy EH, PIC) against wasix-python's `include/python3.14` and py-numpy's wasm headers and Cython declarations.
- **Patch:** `0002-lazy-ctypes.patch` drops the top-level `ctypes` import, since WASIX has no `_ctypes`.
- **Provenance check:** every shipped `.py` is the sdist's file, or the sdist's with that patch applied (`test/py-vs-sdist.mjs`).
- **Notices:** `THIRD-PARTY-NOTICES.md` names the code compiled in (klib, ultrajson, numpy's datetime support, musl) and the licences of the vendored Python code.
