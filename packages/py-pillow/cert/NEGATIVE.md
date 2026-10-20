# py-pillow: negative proof

## 12.3.0-8 fails the 12.3.0-9 cert (homescoop#588, #211 A1)

`cert/arrow.mjs` against npm's 12.3.0-8 (wasix-python 3.14.2-25, slicc-kernel 1.108.4 Node entry, 2026-10-16): FAIL with `rc=134 stderr=python3: wasm trap: function signature mismatch`. `wasm-call-signatures.mjs` on -8's `_imaging` finds `method __arrow_c_schema__ -> ExportArrowSchemaPyCapsule: 1 params, called with 2 (flags 0x1)`, and the same for `__arrow_c_array__`. 12.3.0-9 (from the sdist, with `pillow-wasm-call-signatures.patch`) passes, and the checker finds 0 mismatches in all four side modules.

## 12.3.0-7 (published) fails the 12.3.0-8 cert (homescoop#702)

`node scripts/browser-cert/python-range.mjs py-pillow --tarball ai-ecoverse-py-pillow-12.3.0-7.tgz --lock-only`
(npm's 12.3.0-7; this PR's `package/package.json` gives the floor 3.14.2-16, and
`cert/meta.json` the newest, 3.14.2-24), rc 1:

```
python-range: ok, … with @ai-ecoverse/wasix-python@3.14.2-16 resolves one python, node_modules/@ai-ecoverse/wasix-python 3.14.2-16
python-range: FAIL … with @ai-ecoverse/wasix-python@3.14.2-24:
  - a second python: node_modules/@ai-ecoverse/py-pillow/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
```

12.3.0-8 (a repack of 12.3.0-7 with `">=3.14.2-16 <3.14.3"`) passes both.

In that real npm tree (`npm install @ai-ecoverse/wasix-python@3.14.2-24
@ai-ecoverse/py-pillow@12.3.0-7`, the whole tree in slicc-kernel 1.102.6's Node
entry), `cert/import.mjs` fails with `py-pillow brings no python of its own: True`,
and `cert/pillow.mjs` fails with `ModuleNotFoundError: No module named 'PIL'`:
`_slicc_site.discover()` resolves py-pillow to its nested 3.14.2-16 and skips it.
The 12.3.0-8 tree has one python and passes both specs.

## Spec non-vacuous

`cert/pillow.mjs` asserts exact results (not just that the import works), and
`cert/import.mjs` asserts where PIL was imported from and that no
nested python sits under the package.

## 13.0.0-1: the first cp315 Pillow (homescoop#761; 2026-10-18)

npm's cp314 py-pillow 12.3.0-10 declares `@ai-ecoverse/wasix-python >=3.14.2-27 <3.14.3`, so with wasix-python 3.15.0-1 at the top, npm nests a 3.14 python under it (`cert/import.mjs`: "py-pillow brings no python of its own" fails), and its four `*.cpython-314-wasm32-wasix.so` don't import into python 3.15. 13.0.0-1 passes import, pillow, arrow and ops on 3.15.0-1 (slicc-kernel 1.125.0, Node entry).
