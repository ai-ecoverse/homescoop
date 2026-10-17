# py-cycler: negative proof

## 0.12.1-8: a CI-built root (cert lane, 2026-10-16)

0.12.1-7 and the releases before it repack bytes whose root traces to gitHead f22dcbc2, whose tree has no py-cycler recipe. Nothing can rebuild or attest them. 0.12.1-8 is built in ladder-pr from PyPI's pinned wheel by `scripts/stage-pure-wheel.sh`, so its npm provenance covers the build. It behaves the same as 0.12.1-7: the import and real-use specs pass on both. `record.mjs` is the new check: the files are the wheel's, the `.pyc` match their sources, and its built-in flipped-byte self-test keeps it from being vacuous.

## 0.12.1-6 (published) fails the 0.12.1-7 cert (homescoop#702)

`node scripts/browser-cert/python-range.mjs py-cycler --tarball ai-ecoverse-py-cycler-0.12.1-6.tgz --lock-only`
(npm's 0.12.1-6; this PR's `package/package.json` gives the floor 3.14.2-16, and
`cert/meta.json` the newest, 3.14.2-24), rc 1:

```
python-range: ok, … with @ai-ecoverse/wasix-python@3.14.2-16 resolves one python, node_modules/@ai-ecoverse/wasix-python 3.14.2-16
python-range: FAIL … with @ai-ecoverse/wasix-python@3.14.2-24:
  - a second python: node_modules/@ai-ecoverse/py-cycler/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
```

0.12.1-7 (a repack of 0.12.1-6 with `">=3.14.2-16 <3.14.3"`) passes both.

The pure-Python py-cycler has no floor run (`--lock-only`): its import smoke and `cert/cycler.mjs` run on the newest python in ladder-pr's browser cert.

## Spec non-vacuous

`cert/cycler.mjs` asserts exact results (not just that the import works), and
`cert/import.mjs` asserts where the module was imported from and that no
nested python sits under the package.
