# `@ai-ecoverse/py-pycparser`

[pycparser](https://github.com/eliben/pycparser) 3.12, a C parser in pure Python, for slicc's WASIX CPython (`@ai-ecoverse/wasix-python`).

- **What it is:** PyPI's `pycparser-3.12-py3-none-any.whl`, unpacked as is into `lib/python3/site-packages`. It serves every wasix-python line, so it has no `.pyc` and no wasix-python dependency.
- **Why it's here:** [`@ai-ecoverse/py-cffi`](https://www.npmjs.com/package/@ai-ecoverse/py-cffi) depends on it. cffi's `ffi.cdef()` parses the C declarations you give it with pycparser, in ABI mode and in ffibuilder scripts.
- **Licence:** BSD-3-Clause (`LICENSE`).
