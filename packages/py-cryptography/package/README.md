# `@ai-ecoverse/py-cryptography`

[cryptography](https://cryptography.io) 50.0.2 for slicc WASIX CPython 3.15 (`cpython-315-wasm32-wasix`): hashes, HMAC, AES-GCM and the other ciphers, RSA, EC, Ed25519 and X25519 keys, X.509 certificates, Fernet, and PEM, DER and OpenSSH serialization, with OpenSSL 3.5.9 linked in.

```sh
python3 -c "from cryptography.hazmat.backends.openssl import backend; print(backend.openssl_version_text())"
```

`cryptography/hazmat/bindings/_rust.cpython-315-wasm32-wasix.so` is a `dylink.0` side module that `python.wasm` loads by `dlopen`.

- **Build:** in homescoop's CI from the PyPI sdist. The Rust extension is compiled with cargo for wasix-org/rust's `wasm32-wasmer-wasi-dl` target (`scripts/rust-pyext.sh`, homescoop's toolchain for Rust extensions). OpenSSL 3.5.9 comes from `@ai-ecoverse/wasix-openssl` 3.5.9-4's PIC static libraries; the cffi-generated `_openssl` bindings are compiled in with wasixcc (legacy wasm exceptions, PIC), against `@ai-ecoverse/wasix-python` 3.15.0-8's headers.
- **Needs `_cffi_backend`:** `_rust` contains cryptography's cffi module `_openssl`, which imports `_cffi_backend` from `@ai-ecoverse/py-cffi` when it loads.
- **Python range:** `>=3.15.0-8 <3.15.1 || … || >=3.15.29-1 <3.15.30` (3.15.0-8 or any later 3.15 patch release, homescoop#1939).
- **A Rust panic aborts python.** The target's Rust standard library is built with `panic=abort`, so where cryptography would raise pyo3's `PanicException` (a bug in cryptography, not a bad input), python exits with a trap instead. Normal failures are Python exceptions as everywhere else: `InvalidSignature`, `InvalidTag`, `InvalidToken`, and `ValueError` for malformed keys and certificates.
- **Its own OpenSSL.** `python.wasm` links OpenSSL for `ssl` and `hashlib`; `_rust` has its own copy of the same release (each side module binds its own symbols, `-Bsymbolic`), so `backend.openssl_version_text()` is the version above.
