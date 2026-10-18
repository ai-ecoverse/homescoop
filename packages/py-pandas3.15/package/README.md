# `@ai-ecoverse/py-pandas` (cp315)

Pandas **3.0.6** built as WASIX side modules for `@ai-ecoverse/wasix-python` CPython 3.15 (`cpython-315-wasm32-wasix`). During the Python 3.15 wave (homescoop#761) it's published under the npm dist-tag `python3.15`; `latest` stays on the cp314 line until the flip.

- **Build:** in homescoop's CI from the PyPI sdist, `pandas-3.0.6.tar.gz`, with meson and Cython, against wasix-python 3.15.0-1 and py-numpy 2.5.4-1 (wasix-sysroot 2025.9.30-38; C++ headers from the sysroot). No patches.
- **Ranges:** wasix-python and py-numpy are taken as ranges from those revisions on.
- **pandas 3 changes behaviour from 2.3:**
  - copy-on-write is always on;
  - the default string dtype is `str`, a PyArrow-less Python-backed string array here;
  - pytz isn't a dependency any more;
  - several deprecated APIs are removed.
  See pandas' 3.0 release notes.
