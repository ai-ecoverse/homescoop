# py-cryptography: negative proof

## python-range.mjs: 50.0.2-1 nests a second python under a later 3.15 patch release (50.0.2-2; homescoop#1939; 2026-11-18)

npm `@ai-ecoverse/py-cryptography@50.0.2-1` takes wasix-python as the patch-line range. `npm install --package-lock-only` of its tarball beside a stand-in `@ai-ecoverse/wasix-python` 3.15.2-1 (a package.json-only tarball, `python-range.mjs`'s `fakePython`) resolves a second python from the registry: `node_modules/@ai-ecoverse/py-cffi/node_modules/@ai-ecoverse/wasix-python` 3.15.0-10, `node_modules/@ai-ecoverse/py-cryptography/node_modules/@ai-ecoverse/wasix-python` 3.15.0-10. `_slicc_site` refuses a py-\* whose python isn't the one running, so on wasix-python 3.15.2-1 its import would fail. 50.0.2-2's repack, with the series range, resolves one python, at the top level, with 3.15.1-1, 3.15.2-1 and 3.15.29-1 stand-ins and with the floor and newest from npm.

## 50.0.2-1: the first build (2026-11-17)

There is no earlier py-cryptography, so the negatives are the three things
this build depends on, each taken away once.

### Without py-cffi, `_rust` doesn't import

cryptography 50 compiles its cffi module `_openssl` into `_rust`, and
`_openssl`'s init imports `_cffi_backend`. The same tarball installed in
slicc-kernel 1.189.2's Node entry with wasix-python 3.15.0-8 and no
`@ai-ecoverse/py-cffi`:

```
$ python3 -c 'import cryptography.hazmat.bindings._rust'
ModuleNotFoundError: No module named '_cffi_backend'
rc 1
```

So `cert/import.mjs` (every side module of `cryptography` must import) and
every other spec fail without the `py-cffi` dependency; with it they pass
(`cert/meta.json` needs it).

### Without `scripts/rust-pyext/target-lexicon-dl.patch`, nothing builds

With crates.io's target-lexicon (the spike, before the patch), cargo for
`wasm32-wasmer-wasi-dl` stops in pyo3's build script:

```
error: failed to run custom build command for `pyo3-ffi v0.29.2`
  thread 'main' panicked at …/pyo3-build-config-0.29.2/src/impl_.rs:74:10:
  Unrecognized TARGET environment variable value: UnrecognizedEnvironment("dl")
```

### The side-module check fails on a module that would bind python.wasm's copy

`homescoop_rust_pyext_check` (`scripts/rust-pyext/check-side-module.mjs`)
refuses an import whose name matches `--own`. On this build's `_rust`, the
OpenSSL pattern build.sh passes finds no import (PASS: OpenSSL binds to the
module's own copy, `-Bsymbolic`); the same module checked with
`--own '^Py'`, a library it does not link, fails on all 253 of its C-API imports, e.g.

```
rust-pyext: FAIL env.PyObject_GetTypeData: imported, but the module links its own (--own ^Py)
rust-pyext: FAIL GOT.mem.PyExc_ValueError: imported, but the module links its own (--own ^Py)
```

## Specs non-vacuous

`primitives.mjs` checks known-answer digests (SHA-256, SHA-512, SHA3-256,
BLAKE2b, HMAC-SHA256, PBKDF2) and, for each error path, that the exact
exception class comes back (`InvalidSignature`, `InvalidTag`, `InvalidToken`,
`ValueError`): a build where those paths panicked would end python with a
trap (panic=abort) and fail the spec on its exit status. `keys.mjs` and
`x509.mjs` check each wrong signature is refused, the file mode of az's
private key, and exact subjects, issuers, serials and dates. `threads.mjs`
compares every thread's digests with hashlib's and fails on any exception in
a thread.
