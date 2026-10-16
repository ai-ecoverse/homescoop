# py-fonttools: negative proof

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
