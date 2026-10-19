# py-kiwisolver: negative proof

## 1.5.1-10: the first cp315 kiwisolver (homescoop#761; 2026-10-18)

npm's cp314 py-kiwisolver 1.5.1-9 declares `@ai-ecoverse/wasix-python >=3.14.2-27 <3.14.3`, so with wasix-python 3.15.0-1 at the top, npm nests a 3.14 python under it (`cert/import.mjs`: "brings no python of its own" fails), and its `_cext.cpython-314-wasm32-wasix.so` doesn't import into python 3.15. 1.5.1-10 passes import and solver on 3.15.0-1 (slicc-kernel 1.125.0).

## 1.5.1-7 (published) fails the 1.5.1-8 cert (homescoop#702)

`node scripts/browser-cert/python-range.mjs py-kiwisolver --tarball ai-ecoverse-py-kiwisolver-1.5.1-7.tgz --lock-only`
(npm's 1.5.1-7; this PR's `package/package.json` gives the floor 3.14.2-16, and
`cert/meta.json` the newest, 3.14.2-24), rc 1:

```
python-range: ok, … with @ai-ecoverse/wasix-python@3.14.2-16 resolves one python, node_modules/@ai-ecoverse/wasix-python 3.14.2-16
python-range: FAIL … with @ai-ecoverse/wasix-python@3.14.2-24:
  - a second python: node_modules/@ai-ecoverse/py-kiwisolver/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
```

1.5.1-8 (a repack of 1.5.1-7 with `">=3.14.2-16 <3.14.3"`) passes both.

In that real npm tree (`npm install @ai-ecoverse/wasix-python@3.14.2-24
@ai-ecoverse/py-kiwisolver@1.5.1-7`, the whole tree in slicc-kernel 1.102.6's Node
entry), `cert/import.mjs` fails with `py-kiwisolver brings no python of its own: True`,
and `cert/solver.mjs` fails with `ModuleNotFoundError: No module named 'kiwisolver'`:
`_slicc_site.discover()` resolves py-kiwisolver to its nested 3.14.2-16 and skips it.
The 1.5.1-8 tree has one python and passes both specs.

## 1.5.1-6 (published) fails the 1.5.1-7 cert

`@ai-ecoverse/py-kiwisolver@1.5.1-6` (npm), with the rest of the published
-16 wave (wasix-python 3.14.2-16, py-matplotlib 3.11.2-7, py-numpy 2.3.2-9,
…), slicc-kernel 1.100.4's Node entry, 2026-10-16:

- `cert/solver.mjs` fails at its first strength getter:

  ```
  rc=134 stderr=python3: wasm trap: function signature mismatch
  ```

- `cert/matplotlib.mjs`: the same trap, rc 134, from the constrained layout's
  first `kiwisolver.strength` access.
- `test/wasm-call-signatures.mjs` on its `_cext.cpython-314-wasm32-wasix.so`:
  `27 method defs, 4 getset defs, 21 signature mismatches`, e.g.
  `method value -> …Variable_valueEPNS_8VariableE: 1 params, called with 2 (flags 0x4)`
  and `getter strong -> …strength_strongEPNS_8strengthE: 1 params, called with 2`.

The same tree built without `kiwisolver-wasm-call-signatures.patch` (this
recipe's `build.sh` flags, the patch skipped) traps the same way on 13 of 14
no-argument calls (`hasConstraint`, a `METH_O` method, works); with the patch
all 14, both specs and the checker pass.

## Spec non-vacuous

`solver.mjs` asserts exact solved values for a system that mixes required,
strong and weak constraints with an edit variable, and calls each formerly
trapping method once with a checked result. `matplotlib.mjs` compares the
constrained layout's axes positions against the default layout, so a layout
engine that silently did nothing would fail.
