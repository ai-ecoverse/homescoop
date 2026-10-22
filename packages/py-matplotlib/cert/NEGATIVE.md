# py-matplotlib: negative proof

## cert only on 3.11.2-14: render.mjs (#1263) and the sidemods needs check (#1261; 2026-10-22)

No -N: the published 3.11.2-14 passes `cert/render.mjs` (slicc-kernel 1.144.1, `--users enforce`). #1261's missing py-pytz was fixed in #1259 before it merged (`needs` and `needsInstall` list `@ai-ecoverse/py-pytz`, now `@2026.4.0-5`, npm `latest`), so only the check is new.

- `scripts/test/cert-needs.test.mjs` with py-pytz taken out of `cert/meta.json` (what #1261 saw): FAIL, `packages/py-matplotlib/cert/meta.json: needs py-pytz`, `… needsInstall py-pytz`. The test also runs that case itself on a copy of the meta.
- `cert/render.mjs` on 3.11.2-14 tarballs with one part taken out, each FAIL (rc 1):
  - without `_qhull.cpython-315-wasm32-wasix.so`: `ImportError: cannot import name '_qhull' from 'matplotlib'`;
  - without `backends/backend_ps.py`: `ModuleNotFoundError: No module named 'matplotlib.backends.backend_ps'`;
  - without the `cm*.ttf` and `DejaVuSans*.ttf` fonts: `ValueError: Failed to find font DejaVu Sans…`.
- `prove-negative.mjs` doesn't apply: py-matplotlib has no commands and no `bin/*.wasm`, only side modules.

## 3.11.2-13: the default backend is auto-resolved (3.11.2-14, #1115; 2026-10-20)

`cert/backend.mjs` on npm 3.11.2-13: FAIL, `None False agg` (matplotlibrc has only the inert `##backend: Agg`, so the backend is auto-resolved to lowercase `agg`). 3.11.2-9 and 3.11.2-14 give `Agg True Agg`.

## 3.11.2-11: the first cp315 matplotlib (homescoop#761; 2026-10-19)

npm's cp314 py-matplotlib 3.11.2-10 (`latest`) declares `@ai-ecoverse/wasix-python >=3.14.2-27 <3.14.3` and cp314 py-* ranges, so with wasix-python 3.15.0-1 at the top, npm nests a 3.14 python and the cp314 stack under it. `discovery.mjs`'s re-pin check ("brings a python of its own") fails, and its 8 `*.cpython-314-wasm32-wasix.so` don't import into python 3.15. 3.11.2-11 passes discovery, sidemods, constrained and notices on the published cp315 set (slicc-kernel 1.125.0).

## 3.11.2-9: negative 3.11.2-8 (homescoop#702)

`node scripts/browser-cert/python-range.mjs py-matplotlib --tarball ai-ecoverse-py-matplotlib-3.11.2-8.tgz --lock-only`
(npm's 3.11.2-8, which pins wasix-python 3.14.2-16 and the -16 wave's py-* exactly), rc 1:

```
python-range: ok, … with @ai-ecoverse/wasix-python@3.14.2-16 resolves one python, node_modules/@ai-ecoverse/wasix-python 3.14.2-16
python-range: FAIL … with @ai-ecoverse/wasix-python@3.14.2-24:
  - a second python: node_modules/@ai-ecoverse/py-contourpy/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
  - a second python: node_modules/@ai-ecoverse/py-cycler/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
  - a second python: node_modules/@ai-ecoverse/py-fonttools/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
  - a second python: node_modules/@ai-ecoverse/py-kiwisolver/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
  - a second python: node_modules/@ai-ecoverse/py-matplotlib/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
  - a second python: node_modules/@ai-ecoverse/py-numpy/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
  - a second python: node_modules/@ai-ecoverse/py-packaging/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
  - a second python: node_modules/@ai-ecoverse/py-pillow/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
  - a second python: node_modules/@ai-ecoverse/py-pyparsing/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
```

That is nine extra pythons. 3.11.2-9 resolves one python on both pythons.
With the rest of this cert's harness (wasix-python 3.14.2-24 and the
published range wave), 3.11.2-8 also fails `cert/sidemods.mjs` (and
`cert/discovery.mjs`), at `lib/repinned.mjs`: `every py-* takes
wasix-python 3.14.2-24 and brings none of its own`, because py-matplotlib
3.11.2-8 takes 3.14.2-16. On slicc-kernel 1.102.6's Node entry, 3.11.2-9
passes `constrained.mjs`, `sidemods.mjs` and `discovery.mjs` there.

## 3.11.2-8: negative 3.11.2-7 (homescoop#197)

The published `@ai-ecoverse/py-matplotlib@3.11.2-7` installed from npm (`npm i @ai-ecoverse/py-matplotlib@3.11.2-7`) brings its exact pins, among them py-kiwisolver 1.5.1-6 and wasix-python 3.14.2-16. On slicc-kernel 1.100.4's Node entry, 2026-10-16, `constrained.mjs` (py-kiwisolver's `cert/matplotlib.mjs`) fails:

```
rc=134 stderr=python3: wasm trap: function signature mismatch
```

The same tree with py-kiwisolver 1.5.1-7 (the published tarball of #556), which is what 3.11.2-8 pins, passes: `ConstrainedLayoutEngine`, a PNG, and the left column at x0 0.137 against the default layout's 0.125.

## 3.11.2-10: built from the PyPI sdist (homescoop#211 A5, #743; 2026-10-18)

- **Supply chain:** npm -9 is a repack of a local build (no provenance on its root), and it ships no THIRD-PARTY-NOTICES.md. Its README says FreeType is left unresolved for `@ai-ecoverse/wasm-freetype`, but the side modules actually link it in (#743).
- **`test/py-vs-sdist.mjs --tarball <npm 3.11.2-9>`:** FAIL. It lacks 3 `.py` files that the sdist's own meson install puts in place: `tests/data/tinypages/{conf,range4,range6}.py`.
- **Dependencies:** -9 pins py-numpy 2.3.2-10, py-contourpy 1.4.0-7, py-kiwisolver 1.5.1-8 and py-pillow 12.3.0-8 exactly, so with the -34-wave releases on top npm nests a second copy of each.
