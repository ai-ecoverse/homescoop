# `@ai-ecoverse/py-pynacl`

[PyNaCl](https://github.com/pyca/pynacl) 1.6.2 for slicc WASIX CPython 3.15 (`cpython-315-wasm32-wasix`): `nacl.public` (Box, SealedBox), `nacl.secret` (SecretBox, Aead), `nacl.signing` (Ed25519), `nacl.pwhash` (Argon2i/Argon2id, scrypt), `nacl.hash`, `nacl.utils.random` and the low-level `nacl.bindings`.

`nacl/_sodium.cpython-315-wasm32-wasix.so` is a `dylink.0` side module that `python.wasm` loads by `dlopen`.

- **Build:** in homescoop's CI from the PyPI sdist with `SODIUM_INSTALL=system`: the cffi 2.1.1 that `@ai-ecoverse/py-cffi` ships writes PyNaCl's out-of-line `_sodium` module as C on the host (homescoop's `scripts/cffi-wasix.sh`), and wasixcc (PIC, legacy wasm exceptions) compiles it against `@ai-ecoverse/wasix-python` 3.15.0-1's headers and links `@ai-ecoverse/wasix-libsodium` 1.0.22-1 (`lib-pic/libsodium.a`) statically. The sdist's bundled libsodium is not used.
- **Runtime:** `_sodium` imports `_cffi_backend` from `@ai-ecoverse/py-cffi` (a dependency).
- **Randomness:** `nacl.utils.random` is libsodium's `randombytes_buf`, which on WASIX is libc's `arc4random_buf`, keyed from WASI `random_get` (the kernel's CSPRNG).
- **Password hashing:** Argon2 runs in python's wasm32 memory with libsodium's SIMD128 code; `nacl.pwhash` `INTERACTIVE` (64 MiB), `MODERATE` (256 MiB) and `SENSITIVE` (1 GiB) all work (the cert checks each against Node's `crypto.argon2`). Much more than that won't fit in a 4 GiB wasm32 address space.
- **Python range:** `>=3.15.0-1 <3.15.1`.
