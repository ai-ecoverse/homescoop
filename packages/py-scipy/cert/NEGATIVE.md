# py-scipy: negative proof

## 1.18.0-11 (published) fails the 1.18.0-12 cert (homescoop#702)

`node scripts/browser-cert/python-range.mjs py-scipy --tarball ai-ecoverse-py-scipy-1.18.0-11.tgz --lock-only`
(npm's 1.18.0-11, which pins wasix-python 3.14.2-16 and py-numpy 2.3.2-9 exactly; this
PR's `package/package.json` gives the floor 3.14.2-16, and `cert/meta.json` the
newest, 3.14.2-24), rc 1:

```
python-range: FAIL … with @ai-ecoverse/wasix-python@3.14.2-24:
  - a second python: node_modules/@ai-ecoverse/py-numpy/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
  - a second python: node_modules/@ai-ecoverse/py-scipy/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
```

In that real npm tree (`npm install @ai-ecoverse/wasix-python@3.14.2-24
@ai-ecoverse/py-scipy@1.18.0-11`, the whole tree in slicc-kernel 1.102.6's Node entry),
`cert/import.mjs` fails with `py-scipy brings no python of its own: True`, and
`cert/scipy.mjs` fails with `ModuleNotFoundError: No module named 'numpy'`:
`_slicc_site.discover()` resolves py-scipy and py-numpy 2.3.2-9 to their nested
3.14.2-16 and skips both.

1.18.0-12 (a repack of 1.18.0-11 with `">=3.14.2-16 <3.14.3"` and py-numpy 2.3.2-10)
passes the lockfile check on both pythons, and both specs on 3.14.2-24 and
3.14.2-16.

## Spec non-vacuous

`cert/scipy.mjs` asserts exact results, not just that the import works.
`cert/import.mjs` asserts where scipy was imported from, and that no nested
python sits under the package.
