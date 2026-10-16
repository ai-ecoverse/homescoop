# py-matplotlib: negative proof

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
