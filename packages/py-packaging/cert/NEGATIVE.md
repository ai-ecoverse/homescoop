# py-packaging: negative proof

## 26.3.0-8: a CI-built root (cert lane, 2026-10-16)

26.3.0-7 and the releases before it repack bytes whose root traces to gitHead f22dcbc2, whose tree has no py-packaging recipe. Nothing can rebuild or attest them. 26.3.0-8 is built in ladder-pr from PyPI's pinned wheel by `scripts/stage-pure-wheel.sh`, so its npm provenance covers the build. It behaves the same as 26.3.0-7: the import and real-use specs pass on both. `record.mjs` is the new check: the files are the wheel's, the `.pyc` match their sources, and its built-in flipped-byte self-test keeps it from being vacuous.

## 26.3.0-6 (published) fails the 26.3.0-7 cert (homescoop#702)

`node scripts/browser-cert/python-range.mjs py-packaging --tarball ai-ecoverse-py-packaging-26.3.0-6.tgz --lock-only`
(npm's 26.3.0-6; this PR's `package/package.json` gives the floor 3.14.2-16, and
`cert/meta.json` the newest, 3.14.2-24), rc 1:

```
python-range: ok, … with @ai-ecoverse/wasix-python@3.14.2-16 resolves one python, node_modules/@ai-ecoverse/wasix-python 3.14.2-16
python-range: FAIL … with @ai-ecoverse/wasix-python@3.14.2-24:
  - a second python: node_modules/@ai-ecoverse/py-packaging/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
```

26.3.0-7 (a repack of 26.3.0-6 with `">=3.14.2-16 <3.14.3"`) passes both.

The pure-Python py-packaging has no floor run (`--lock-only`): its import smoke and `cert/packaging.mjs` run on the newest python in ladder-pr's browser cert.

## Spec non-vacuous

`cert/packaging.mjs` asserts exact results (not just that the import works), and
`cert/import.mjs` asserts where the module was imported from and that no
nested python sits under the package.
