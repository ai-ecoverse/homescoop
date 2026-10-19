# Negative proof (py-numpy, cp315 line)

## 2.5.4-1: the first cp315 numpy (homescoop#761; 2026-10-18)

`cert/import.mjs` with wasix-python 3.15.0-1 and npm's cp314 py-numpy 2.3.2-12 instead of this tarball (slicc-kernel 1.125.0, Node entry): FAIL, `py-numpy brings no python of its own`. 2.3.2-12 declares `@ai-ecoverse/wasix-python >=3.14.2-27 <3.14.3`, so npm nests a second, 3.14 python under it. Its 19 side modules are `*.cpython-314-wasm32-wasix.so`, which python 3.15 (EXT_SUFFIX `.cpython-315-wasm32-wasix.so`) doesn't import. 2.5.4-1 passes import, numpy, patches and linalg-errors on 3.15.0-1.
