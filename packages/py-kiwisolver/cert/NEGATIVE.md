# py-kiwisolver: negative proof

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
