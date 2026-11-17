# @ai-ecoverse/wasix-libsodium

[libsodium](https://libsodium.org) 1.0.22 for [slicc](https://github.com/ai-ecoverse/slicc)
WASIX programs and side modules, built with the pinned wasixcc on
wasix-sysroot 2025.9.30-40 (the sysroot of wasix-python 3.15.0-8).
A build-time package: no commands. py-pynacl's `nacl._sodium` links it.

| directory | for |
| --- | --- |
| `lib/libsodium.a` | static-main programs (non-PIC), e.g. on the asyncify sysroot |
| `lib-pic/libsodium.a` | dynamic-main programs and side modules (`-fPIC`, legacy wasm EH), e.g. CPython extensions for wasix-python |
| `include/` | `sodium.h`, `sodium/*.h` |
| `lib/pkgconfig/libsodium.pc`, `lib-pic/pkgconfig/libsodium.pc` | pkg-config, relative to the package |

```sh
PKG_CONFIG_PATH=node_modules/@ai-ecoverse/wasix-libsodium/lib-pic/pkgconfig \
  wasixcc -fPIC app.c $(pkg-config --cflags --libs libsodium)
```

- **Tested:** libsodium's own test suite (`test/default`, 101 tests) passes on
  both flavours in slicc-kernel, plus known-answer probes (RFC 8032, RFC 7748,
  RFC 8439, RFC 7914, Argon2 against Node's crypto).
- **Full build:** not `--enable-minimal`, so `crypto_box_seal`, `crypto_pwhash`
  (Argon2i/Argon2id and scrypt), `crypto_secretstream`, `crypto_kx` and the
  rest are there.
- **Randomness:** WASIX defines `__wasi__`, so `randombytes_buf` is
  libc's `arc4random_buf`: wasix-libc's per-thread ChaCha20 generator, keyed
  from WASI `random_get` (the kernel's CSPRNG) through `getentropy`. Nothing
  opens `/dev/urandom`; the build refuses an archive that mentions it.
  wasix-libc's generator doesn't reseed across `fork()`, which slicc-kernel
  doesn't offer (ENOSYS); the cert fails if a forked child ever repeats its
  parent's bytes.
- **No assembly, SIMD128 on:** `--disable-asm` (no x86/ARM code paths). wasixcc
  builds every WASIX program with `simd128` (python.wasm too), so Argon2 uses
  libsodium's wasm32 SIMD `fill_segment`, with upstream's fix from after
  1.0.22 (`libsodium-argon2-wasm32-fblamka.patch`, 1b37a23c55): without it
  every Argon2i/Argon2id hash is wrong.
- **Deterministic Ed25519:** `ED25519_NONDETERMINISTIC` is not set, so
  signatures are RFC 8032's.
- **Threads:** pthreads on; `sodium_init()` is safe to call from several threads.

Recipe: [homescoop/packages/wasix-libsodium](https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasix-libsodium).
