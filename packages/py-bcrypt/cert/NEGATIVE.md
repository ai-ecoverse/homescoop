# py-bcrypt: negative proof

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
