# py-numpy: negative proof

## 2.3.2-9 (published) fails the 2.3.2-10 cert (homescoop#702)

`node scripts/browser-cert/python-range.mjs py-numpy --tarball ai-ecoverse-py-numpy-2.3.2-9.tgz --lock-only`
(npm's 2.3.2-9; this PR's `package/package.json` gives the floor 3.14.2-16, and
`cert/meta.json` the newest, 3.14.2-24), rc 1:

```
python-range: ok, … with @ai-ecoverse/wasix-python@3.14.2-16 resolves one python, node_modules/@ai-ecoverse/wasix-python 3.14.2-16
python-range: FAIL … with @ai-ecoverse/wasix-python@3.14.2-24:
  - a second python: node_modules/@ai-ecoverse/py-numpy/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
```

2.3.2-10 (a repack of 2.3.2-9 with `">=3.14.2-16 <3.14.3"`) passes both.

In that real npm tree (`npm install @ai-ecoverse/wasix-python@3.14.2-24
@ai-ecoverse/py-numpy@2.3.2-9`, the whole tree in slicc-kernel 1.102.6's Node
entry), `cert/import.mjs` fails with `py-numpy brings no python of its own: True`,
and `cert/numpy.mjs` fails with `ModuleNotFoundError: No module named 'numpy'`:
`_slicc_site.discover()` resolves py-numpy to its nested 3.14.2-16 and skips it.
The 2.3.2-10 tree has one python and passes both specs.

## Spec non-vacuous

`cert/numpy.mjs` asserts exact results (not just that the import works), and
`cert/import.mjs` asserts where numpy was imported from and that no
nested python sits under the package.
