# Negative proof (py-pandas, cp315 line)

## 3.0.6-1: the first cp315 pandas (homescoop#761; 2026-10-18)

npm's cp314 py-pandas 2.3.2-12 declares `@ai-ecoverse/wasix-python >=3.14.2-27 <3.14.3` and `@ai-ecoverse/py-numpy >=2.3.2-11 <2.3.3`, so with wasix-python 3.15.0-1 at the top, npm nests a 3.14 python and a cp314 numpy under it. Its 44 `*.cpython-314-wasm32-wasix.so` don't import into python 3.15 (EXT_SUFFIX `.cpython-315-wasm32-wasix.so`). 3.0.6-1 passes `cert/import.mjs` (45 side modules) and `cert/pandas.mjs` on 3.15.0-1 with py-numpy 2.5.4-1 (slicc-kernel 1.125.0, Node entry). `pandas.mjs` now expects pandas 3's `str` dtype for text columns (2.x: `object`).
