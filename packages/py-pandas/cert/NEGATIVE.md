# Negative proof (py-pandas, cp315 line)

## python-range.mjs: 3.0.6-4 nests a second python under a later 3.15 patch release (3.0.6-5; homescoop#1939; 2026-11-18)

npm `@ai-ecoverse/py-pandas@3.0.6-4` takes wasix-python as the patch-line range. `npm install --package-lock-only` of its tarball beside a stand-in `@ai-ecoverse/wasix-python` 3.15.2-1 (a package.json-only tarball, `python-range.mjs`'s `fakePython`) resolves a second python from the registry: `node_modules/@ai-ecoverse/py-numpy/node_modules/@ai-ecoverse/wasix-python` 3.15.0-10, `node_modules/@ai-ecoverse/py-pandas/node_modules/@ai-ecoverse/wasix-python` 3.15.0-10. `_slicc_site` refuses a py-\* whose python isn't the one running, so on wasix-python 3.15.2-1 its import would fail. 3.0.6-5's repack, with the series range, resolves one python, at the top level, with 3.15.1-1, 3.15.2-1 and 3.15.29-1 stand-ins and with the floor and newest from npm.

## cert-only on 3.0.6-4: a needsInstall peer left out of needs (#1190; 2026-10-22)

`scripts/test/cert-needs.test.mjs` fails a py-* meta.json that installs a package without mounting it: with `@ai-ecoverse/py-six` taken out of `needs` here, it fails with `packages/py-pandas/cert/meta.json: @ai-ecoverse/py-six is in needsInstall but not in needs`, and its fixture of py-pandas3.15 3.0.6-1's meta as cert-review saw it on #1188 is flagged the same way (there `cert/import.mjs` failed with `ModuleNotFoundError: No module named 'six'`). The current meta passes. The new pandas.mjs rows (#1192) and cert/users.mjs (#1333) are coverage: npm 3.0.6-4 passes them, so no version change.

## 3.0.6-3: the notices preamble names pandas 2.3.2 (3.0.6-4, #1191; 2026-10-20)

`cert/notices-preamble.mjs` on npm 3.0.6-3: FAIL, `preamble names pandas 3.0.6's LICENSES/` (it says "pandas 2.3.2's LICENSES/"). 3.0.6-4 passes.

## 3.0.6-1: the first cp315 pandas (homescoop#761; 2026-10-18)

npm's cp314 py-pandas 2.3.2-12 declares `@ai-ecoverse/wasix-python >=3.14.2-27 <3.14.3` and `@ai-ecoverse/py-numpy >=2.3.2-11 <2.3.3`, so with wasix-python 3.15.0-1 at the top, npm nests a 3.14 python and a cp314 numpy under it. Its 44 `*.cpython-314-wasm32-wasix.so` don't import into python 3.15 (EXT_SUFFIX `.cpython-315-wasm32-wasix.so`). 3.0.6-1 passes `cert/import.mjs` (45 side modules) and `cert/pandas.mjs` on 3.15.0-1 with py-numpy 2.5.4-1 (slicc-kernel 1.125.0, Node entry). `pandas.mjs` now expects pandas 3's `str` dtype for text columns (2.x: `object`).
