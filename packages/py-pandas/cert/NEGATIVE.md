# py-pandas: negative proof

## 2.3.2-10 (published) fails the 2.3.2-11 cert (homescoop#702)

`node scripts/browser-cert/python-range.mjs py-pandas --tarball ai-ecoverse-py-pandas-2.3.2-10.tgz --lock-only`
(npm's 2.3.2-10, which pins wasix-python 3.14.2-16 and py-numpy 2.3.2-9 exactly; this
PR's `package/package.json` gives the floor 3.14.2-16, and `cert/meta.json` the
newest, 3.14.2-24), rc 1:

```
python-range: FAIL … with @ai-ecoverse/wasix-python@3.14.2-24:
  - a second python: node_modules/@ai-ecoverse/py-numpy/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
  - a second python: node_modules/@ai-ecoverse/py-pandas/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
```

In that real npm tree (`npm install @ai-ecoverse/wasix-python@3.14.2-24
@ai-ecoverse/py-pandas@2.3.2-10`, the whole tree in slicc-kernel 1.102.6's Node entry),
`cert/import.mjs` fails with `py-pandas brings no python of its own: True`, and
`cert/pandas.mjs` fails with `ModuleNotFoundError: No module named 'numpy'`:
`_slicc_site.discover()` resolves py-pandas and py-numpy 2.3.2-9 to their nested
3.14.2-16 and skips both.

2.3.2-11 (a repack of 2.3.2-10 with `">=3.14.2-16 <3.14.3"` and py-numpy 2.3.2-10)
passes the lockfile check on both pythons, and both specs on 3.14.2-24 and
3.14.2-16.

## Spec non-vacuous

`cert/pandas.mjs` asserts exact results, not just that the import works.
`cert/import.mjs` asserts where pandas was imported from, and that no nested
python sits under the package.
