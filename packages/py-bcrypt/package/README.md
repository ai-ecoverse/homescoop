# `@ai-ecoverse/py-bcrypt`

[bcrypt](https://github.com/pyca/bcrypt) 5.0.0 for slicc WASIX CPython 3.15 (`cpython-315-wasm32-wasix`): `hashpw`, `checkpw`, `gensalt` and `kdf` (bcrypt-pbkdf, which paramiko uses for encrypted OpenSSH private keys).

```sh
python3 -c "import bcrypt; h = bcrypt.hashpw(b'secret', bcrypt.gensalt()); print(bcrypt.checkpw(b'secret', h))"
```

`bcrypt/_bcrypt.cpython-315-wasm32-wasix.so` is a `dylink.0` side module that `python.wasm` loads by `dlopen`.

- **Build:** in homescoop's CI from the PyPI sdist. The Rust extension is compiled with cargo for wasix-org/rust's `wasm32-wasmer-wasi-dl` target with `scripts/rust-pyext.sh`, homescoop's toolchain for Rust extensions (as `@ai-ecoverse/py-cryptography`). Random salts come from WASI's `random_get` (getrandom 0.3.3 with `scripts/rust-pyext/getrandom-dl.patch`).
- **Python range:** `>=3.15.0-8 <3.15.1`.
- **A Rust panic aborts python.** The target's Rust standard library is built with `panic=abort`, so where bcrypt would raise pyo3's `PanicException` (a bug, not a bad input), python exits with a trap instead. Bad inputs are Python exceptions as everywhere else: `ValueError` for an invalid salt or rounds out of range, `TypeError` for a `str` password.
