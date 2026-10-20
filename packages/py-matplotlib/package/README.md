# @ai-ecoverse/py-matplotlib

Matplotlib 3.11.2 for slicc WASIX CPython 3.15 (`cp315-wasix_wasm32`). Since the Python 3.15 flip (homescoop#761) this is `latest`; the cp314 builds stay on npm by exact version ([release notes](https://github.com/ai-ecoverse/homescoop/blob/main/docs/release-notes/python-3.15.md)).

- **Default backend:** Agg.
- **Build:** in homescoop's CI from the PyPI sdist, `matplotlib-3.11.2.tar.gz` (sha256 `cec59631…`). The side modules are built with wasixcc (`sysroot-ehpic`, legacy EH, PIC) against wasix-python 3.15.0-1, on wasix-sysroot 2025.9.30-38 with the sysroot's libc++ headers.
- **Compiled in:**
  - FreeType 2.14.3, HarfBuzz 14.1.0, libraqm 0.10.5, SheenBidi and Qhull 8.0.2 (matplotlib's own meson subprojects, pinned);
  - Agg;
  - pybind11's headers.
- **Notices:** `THIRD-PARTY-NOTICES.md` carries their licences and the fonts'.
- **Dependencies:** the CPython 3.15.0 line of wasix-python (a range, from 3.15.0-1), plus the cp315 py-numpy, py-contourpy, py-kiwisolver and py-pillow (as ranges) and the cp315 pure packages.
