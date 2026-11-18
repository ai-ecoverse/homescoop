# py-bcrypt: negative proof

## python-range.mjs: 5.0.0-1 nests a second python under a later 3.15 patch release (5.0.0-2; homescoop#1939; 2026-11-18)

npm `@ai-ecoverse/py-bcrypt@5.0.0-1` takes wasix-python as the patch-line range. `npm install --package-lock-only` of its tarball beside a stand-in `@ai-ecoverse/wasix-python` 3.15.2-1 (a package.json-only tarball, `python-range.mjs`'s `fakePython`) resolves a second python from the registry: `node_modules/@ai-ecoverse/py-bcrypt/node_modules/@ai-ecoverse/wasix-python` 3.15.0-10. `_slicc_site` refuses a py-\* whose python isn't the one running, so on wasix-python 3.15.2-1 its import would fail. 5.0.0-2's repack, with the series range, resolves one python, at the top level, with 3.15.1-1, 3.15.2-1 and 3.15.29-1 stand-ins and with the floor and newest from npm.

## 5.0.0-1: the first build (2026-11-17)

There is no earlier py-bcrypt. The negatives are the two crate patches this
build takes from `scripts/rust-pyext/`, each left out once.

### Without `getrandom-dl.patch`, nothing builds

getrandom 0.3.3 picks its WASI backend by `target_env` (`p1`, `p2`) and
refuses `dl`, the environment of wasix-org/rust's `wasm32-wasmer-wasi-dl`:

```
error: Unknown version of WASI (only previews 1 and 2 are supported) or Rust version older than 1.80 was used
```

With the patch, `dl` takes the preview 1 backend (`random_get` from
`wasi_snapshot_preview1`), and `cert/bcrypt.mjs` sees 20 different salts.

### Without `target-lexicon-dl.patch`, nothing builds

As for py-cryptography: pyo3's build script panics with
`Unrecognized TARGET environment variable value: UnrecognizedEnvironment("dl")`.

## Specs non-vacuous

`bcrypt.mjs` compares `hashpw` and `kdf` with the exact strings CPython's
bcrypt 5.0.0 (the PyPI wheel) gives for the same inputs, needs `checkpw` to
refuse a wrong password, and needs each bad input to raise its exception
class: a build where they panicked would end python with a trap
(panic=abort) and fail on the exit status.
