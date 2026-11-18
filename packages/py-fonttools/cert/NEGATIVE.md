# py-fonttools: negative proof

## python-range.mjs: 4.66.1-11 nests a second python under a later 3.15 patch release (4.66.1-12; homescoop#1939; 2026-11-18)

npm `@ai-ecoverse/py-fonttools@4.66.1-11` takes wasix-python as the patch-line range. `npm install --package-lock-only` of its tarball beside a stand-in `@ai-ecoverse/wasix-python` 3.15.2-1 (a package.json-only tarball, `python-range.mjs`'s `fakePython`) resolves a second python from the registry: `node_modules/@ai-ecoverse/py-fonttools/node_modules/@ai-ecoverse/wasix-python` 3.15.0-10. `_slicc_site` refuses a py-\* whose python isn't the one running, so on wasix-python 3.15.2-1 its import would fail. 4.66.1-12's repack, with the series range, resolves one python, at the top level, with 3.15.1-1, 3.15.2-1 and 3.15.29-1 stand-ins and with the floor and newest from npm.

## The first cp315 release (homescoop#761; 2026-10-18)

npm's cp314 py-fonttools (`latest`) declares `@ai-ecoverse/wasix-python >=3.14.2-16 <3.14.3`, so with wasix-python 3.15.0-1 at the top, npm nests a second, 3.14 python under it (python-range.mjs --lock-only fails, as for the 3.14.2-16 exact pin below). Its .pyc files are `cpython-314`, which 3.15 doesn't use. The cp315 tarball resolves one python and passes every spec on 3.15.0-1 (slicc-kernel 1.125.0); cert/record.mjs checks its `cpython-315` .pyc.

## 4.66.1-8: a CI-built root (cert lane, 2026-10-16)

4.66.1-7 and the releases before it repack bytes whose root traces to gitHead f22dcbc2, whose tree has no py-fonttools recipe. Nothing can rebuild or attest them. 4.66.1-8 is built in ladder-pr from PyPI's pinned wheel by `scripts/stage-pure-wheel.sh`, so its npm provenance covers the build. It behaves the same as 4.66.1-7: the import and real-use specs pass on both. `record.mjs` is the new check: the files are the wheel's, the `.pyc` match their sources, and its built-in flipped-byte self-test keeps it from being vacuous.

## 4.66.1-6 (published) fails the 4.66.1-7 cert (homescoop#702)

`node scripts/browser-cert/python-range.mjs py-fonttools --tarball ai-ecoverse-py-fonttools-4.66.1-6.tgz --lock-only`
(npm's 4.66.1-6; this PR's `package/package.json` gives the floor 3.14.2-16, and
`cert/meta.json` the newest, 3.14.2-24), rc 1:

```
python-range: ok, … with @ai-ecoverse/wasix-python@3.14.2-16 resolves one python, node_modules/@ai-ecoverse/wasix-python 3.14.2-16
python-range: FAIL … with @ai-ecoverse/wasix-python@3.14.2-24:
  - a second python: node_modules/@ai-ecoverse/py-fonttools/node_modules/@ai-ecoverse/wasix-python 3.14.2-16
```

4.66.1-7 (a repack of 4.66.1-6 with `">=3.14.2-16 <3.14.3"`) passes both.

The pure-Python py-fonttools has no floor run (`--lock-only`): its import smoke and `cert/fonttools.mjs` run on the newest python in ladder-pr's browser cert.

## Spec non-vacuous

`cert/fonttools.mjs` asserts exact results (not just that the import works), and
`cert/import.mjs` asserts where the module was imported from and that no
nested python sits under the package.
