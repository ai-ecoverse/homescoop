# @ai-ecoverse/py-matplotlib

Matplotlib 3.11.2 for slicc WASIX CPython 3.14 (`cp314-wasix_wasm32`).

- Default backend: **Agg**

## Since 3.11.2-10

- **Source:** built in homescoop's CI from the PyPI sdist, `matplotlib-3.11.2.tar.gz` (sha256 `cec59631…`). Up to -9 the package was a repack of a local build.
- **Compiled in:** FreeType 2.14.3, HarfBuzz 14.1.0, libraqm 0.10.5, SheenBidi and Qhull 8.0.2. These are matplotlib's own meson subprojects, pinned to the sha256s its wraps name, with no download at build time.
- **Also compiled in:** Agg and pybind11's headers.
- **Toolchain:** wasixcc side modules (`sysroot-ehpic`, legacy EH, PIC) against wasix-python 3.14.2-27.
- **Notices:** `THIRD-PARTY-NOTICES.md` carries their licences and the fonts' (BaKoMa, DejaVu, STIX, Last Resort).
- **Dependencies:** py-numpy, py-contourpy, py-kiwisolver and py-pillow are taken as ranges, so npm installs one of each.

## Since 3.11.2-9

Takes `@ai-ecoverse/wasix-python` as a range, the CPython 3.14.2 line from
packaging revision 16 up, and depends on the py-* that take it the same way
(homescoop#702). With a newer
python, npm installs one python, not a second one under each py-*, and
`_slicc_site.discover()` finds every py-* without PYTHONPATH. The matplotlib
bytes are 3.11.2-7's; only `package.json` and this README change.

## Since 3.11.2-8

Depends on `@ai-ecoverse/py-kiwisolver` 1.5.1-7, so `layout="constrained"`
(and `constrained_layout=True`) works. Through 3.11.2-7 the pinned
py-kiwisolver 1.5.1-6 ended python with `wasm trap: function signature
mismatch` as soon as the constrained layout engine ran (homescoop#197). The
matplotlib bytes are 3.11.2-7's; only `package.json` changes.
