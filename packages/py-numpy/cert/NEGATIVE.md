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

## 2.3.2-12: LinAlgError for a failed factorisation (homescoop#1082; 2026-10-18)

`cert/linalg-errors.mjs` against the published 2.3.2-11 on slicc-kernel 1.120.2 (Node entry, wasix-python 3.14.2-27): FAIL. Every case returns a result instead of raising: `{"solve_singular":["ok",true],"inv_singular":["ok",true],"inv_singular_f32":["ok",true],"inv_singular_c128":["ok",true],"cholesky_nonpd":["ok",true],"inv_batch_one_singular":["ok",true], …}`. `true` means the result holds NaN, so a singular system silently gives a wrong answer. Linux raises `LinAlgError`. The control rows (`solve_good` [2, 3]) pass on both.
