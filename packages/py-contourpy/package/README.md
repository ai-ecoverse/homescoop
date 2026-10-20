# `@ai-ecoverse/py-contourpy`

contourpy 1.4.0 for slicc WASIX CPython 3.15 (`cpython-315-wasm32-wasix`). Since the Python 3.15 flip (homescoop#761) this is `latest`; the cp314 builds stay on npm by exact version ([release notes](https://github.com/ai-ecoverse/homescoop/blob/main/docs/release-notes/python-3.15.md)).

- **Build:** in homescoop's CI from the sdist. `_contourpy` is compiled with wasixcc++ and pybind11 3.0.1 against the C++ runtime that `@ai-ecoverse/wasix-python` 3.15.0-1 exports (wasix-sysroot 2025.9.30-38 `sysroot-ehpic` headers).
- **Dependencies:** wasix-python `>=3.15.0-1 <3.15.1` and py-numpy `>=2.5.4-1 <2.5.5`.
- **Notices:** `THIRD-PARTY-NOTICES.md` names pybind11.
