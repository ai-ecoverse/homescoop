# py-pandas pre-stage checklist

## Build requirements
- Meson **cross file** with `[host_machine] system='wasi' cpu_family='wasm32'`, wasixcc as c/cpp,
  `needs_exe_wrapper=true`, wasix-python + **wasm** py-numpy include dirs in `c_args`.
- `sitecustomize` (or equivalent) so host build Python reports
  `EXT_SUFFIX=.cpython-314-wasm32-wasix.so`, `SIZEOF_LONG=4`, `get_platform()=wasix_wasm32`,
  and `numpy.get_include()` → **py-numpy** `.../numpy/_core/include` (verify `NPY_SIZEOF_LONG 4`).
- Prefer Cython 3.1.3 (PyPI pandas 2.3.2). With a correct cross build, newer Cython may work;
  still pin until proven.
- Apply `patches/0002-lazy-ctypes.patch` (lazy `import ctypes` in errors + interchange
  `buffer_to_ndarray`; clipboard may keep top-level import).
- Last step: `homescoop_compile_pyc` (host python3.14, `--invalidation-mode unchecked-hash`).

## Hard checks (fail the stage if any miss)
1. **WHEEL tag** must not contain `macosx` / `darwin`. Expect `Tag: cp314-cp314-wasix_wasm32`.
2. **No renames**: meson-python must emit `*.cpython-314-wasm32-wasix.so` directly
   (object dirs named `*.cpython-314-wasm32-wasix.so.p` during compile).
3. **`import pandas` must succeed** under SLICC / a WASIX runner (no `_ctypes` stub). Local tip:
   `wasmtime -W exceptions=y` / newer wasmer `--enable-all`. If the runner lacks
   **legacy** EH (`try` instruction), local smoke will fail to compile the module —
   hand the stage to acceptance earlier rather than guessing.
4. `node unresolved.mjs python.wasm $(find … -name '*.so')` → 0 unresolved.
5. `grep NPY_SIZEOF_LONG …/py-numpy/.../_numpyconfig.h` → `4`.
6. **`.pyc` count ≈ `.py` count** under `site-packages` (target: warm/cold import without recompile;
   pandas ≤ ~1.5 s, numpy ≤ ~0.3 s).
7. **Top-level ctypes confined to clipboard:**
   `grep -rnE '^(import ctypes|from ctypes)' --include='*.py'` under site-packages,
   excluding `/tests/`. Only `pandas/io/clipboard/` may match. Indented imports are OK
   (lazy / guarded).
