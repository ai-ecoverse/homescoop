# py-contourpy: negative proof

## 1.4.0-10: the first cp315 contourpy (homescoop#761; 2026-10-18)

npm's cp314 py-contourpy 1.4.0-9 declares `@ai-ecoverse/wasix-python >=3.14.2-27 <3.14.3` and `@ai-ecoverse/py-numpy >=2.3.2-10 <2.3.3`, so with wasix-python 3.15.0-1 at the top, npm nests a 3.14 python and a cp314 numpy under it, and its `_contourpy.cpython-314-wasm32-wasix.so` doesn't import into python 3.15. 1.4.0-10 passes import, contourpy, errors and notices on 3.15.0-1 with py-numpy 2.5.4-1 (slicc-kernel 1.125.0).

## 1.4.0-8 (homescoop#211 A2): -7 behaves the same; it wasn't built in this repo

npm's 1.4.0-7 passes this cert's specs as well: `import.mjs`, `contourpy.mjs` and the new `errors.mjs`, on slicc-kernel 1.108.4's Node entry with wasix-python 3.14.2-25 (2026-10-16). Its bytes come from a build outside homescoop: a meson-python cross build in a `/tmp` venv, whose `_build_config.py` records `/private/tmp/wasix-mpl-ext/...`. ladder-pr couldn't rebuild or check them (`repack:`). 1.4.0-8 is the same contourpy 1.4.0 and pybind11 3.0.1, compiled from the sdist by `build.sh` in CI with `reproducible: true`. It takes wasix-python `>=3.14.2-25` (the headers it is built against) and py-numpy as a range. `errors.mjs` isn't vacuous: it asserts the exact exception types and messages, which a trap (rc 134) or a swallowed C++ exception would fail.

## 1.4.0-6 (published) fails the 1.4.0-7 cert (homescoop#702)

`node scripts/browser-cert/python-range.mjs py-contourpy --tarball ai-ecoverse-py-contourpy-1.4.0-6.tgz --lock-only`
(npm's 1.4.0-6, which pins wasix-python 3.14.2-16 and py-numpy 2.3.2-9 exactly; this
PR's `package/package.json` gives the floor 3.14.2-16, and `cert/meta.json` the
newest, 3.14.2-24), rc 1:

```
python-range: FAIL … with @ai-ecoverse/wasix-python@3.14.2-24:
  - a second python: node_modules/@ai-ecoverse/py-contourpy/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
  - a second python: node_modules/@ai-ecoverse/py-numpy/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
```

In that real npm tree (`npm install @ai-ecoverse/wasix-python@3.14.2-24
@ai-ecoverse/py-contourpy@1.4.0-6`, the whole tree in slicc-kernel 1.102.6's Node entry),
`cert/import.mjs` fails with `py-contourpy brings no python of its own: True`, and
`cert/contourpy.mjs` fails with `ModuleNotFoundError: No module named 'numpy'`:
`_slicc_site.discover()` resolves py-contourpy and py-numpy 2.3.2-9 to their nested
3.14.2-16 and skips both.

1.4.0-7 (a repack of 1.4.0-6 with `">=3.14.2-16 <3.14.3"` and py-numpy 2.3.2-10)
passes the lockfile check on both pythons, and both specs on 3.14.2-24 and
3.14.2-16.

## Spec non-vacuous

`cert/contourpy.mjs` asserts exact results, not just that the import works.
`cert/import.mjs` asserts where contourpy was imported from, and that no nested
python sits under the package.
