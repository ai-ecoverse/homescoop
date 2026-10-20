# py-pyparsing: negative proof

## The first cp315 release (homescoop#761; 2026-10-18)

npm's cp314 py-pyparsing (`latest`) declares `@ai-ecoverse/wasix-python >=3.14.2-16 <3.14.3`, so with wasix-python 3.15.0-1 at the top, npm nests a second, 3.14 python under it (python-range.mjs --lock-only fails, as for the 3.14.2-16 exact pin below). Its .pyc files are `cpython-314`, which 3.15 doesn't use. The cp315 tarball resolves one python and passes every spec on 3.15.0-1 (slicc-kernel 1.125.0); cert/record.mjs checks its `cpython-315` .pyc.

## 3.3.3-8: a CI-built root (cert lane, 2026-10-16)

3.3.3-7 and the releases before it repack bytes whose root traces to gitHead f22dcbc2, whose tree has no py-pyparsing recipe. Nothing can rebuild or attest them. 3.3.3-8 is built in ladder-pr from PyPI's pinned wheel by `scripts/stage-pure-wheel.sh`, so its npm provenance covers the build. It behaves the same as 3.3.3-7: the import and real-use specs pass on both. `record.mjs` is the new check: the files are the wheel's, the `.pyc` match their sources, and its built-in flipped-byte self-test keeps it from being vacuous.

## 3.3.3-6 (published) fails the 3.3.3-7 cert (homescoop#702)

`node scripts/browser-cert/python-range.mjs py-pyparsing --tarball ai-ecoverse-py-pyparsing-3.3.3-6.tgz --lock-only`
(npm's 3.3.3-6; this PR's `package/package.json` gives the floor 3.14.2-16, and
`cert/meta.json` the newest, 3.14.2-24), rc 1:

```
python-range: ok, … with @ai-ecoverse/wasix-python@3.14.2-16 resolves one python, node_modules/@ai-ecoverse/wasix-python 3.14.2-16
python-range: FAIL … with @ai-ecoverse/wasix-python@3.14.2-24:
  - a second python: node_modules/@ai-ecoverse/py-pyparsing/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
```

3.3.3-7 (a repack of 3.3.3-6 with `">=3.14.2-16 <3.14.3"`) passes both.

The pure-Python py-pyparsing has no floor run (`--lock-only`): its import smoke and `cert/pyparsing.mjs` run on the newest python in ladder-pr's browser cert.

## Spec non-vacuous

`cert/pyparsing.mjs` asserts exact results (not just that the import works), and
`cert/import.mjs` asserts where the module was imported from and that no
nested python sits under the package.
