# `@ai-ecoverse/py-pandas`

Pandas 2.3.2 built as WASIX side modules for `@ai-ecoverse/wasix-python` (CPython 3.14, `cpython-314-wasm32-wasix`).

Requires `@ai-ecoverse/py-numpy` and the pure-Python date/tz helpers listed in `package.json`.

## Build notes
- Meson **cross file** (`system='wasi'`, `cpu_family='wasm32'`) + sitecustomize so meson-python
  tags `cp314-cp314-wasix_wasm32` and emits `*.cpython-314-wasm32-wasix.so` natively (no Darwin rename).
- Compile includes: wasix-python `include/python3.14` and **wasm** py-numpy headers
  (`NPY_SIZEOF_LONG` / `NPY_SIZEOF_INTP` = 4).
- Cython **3.1.3** (matches PyPI).
- `patches/0002-lazy-ctypes.patch`: no top-level `ctypes` (wasix has no `_ctypes`).
- Last step: `homescoop_compile_pyc` (unchecked-hash `.pyc` for every `.py`).

See `../PRESTAGE.md`.
