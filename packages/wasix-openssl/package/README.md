# @ai-ecoverse/wasix-openssl

[OpenSSL](https://www.openssl.org) 3.5.9 (LTS) for
[slicc](https://github.com/ai-ecoverse/slicc) WASIX programs, built with the
pinned wasixcc on wasix-sysroot 2025.9.30-17. A build-time package: no
commands, no `openssl` CLI.

| directory | for |
| --- | --- |
| `lib/libcrypto.a`, `lib/libssl.a` | static-main programs (non-PIC), e.g. on the asyncify sysroot |
| `lib-pic/libcrypto.a`, `lib-pic/libssl.a` | dynamic-main programs and side modules (`-fPIC`) |
| `include/openssl/` | headers (the same for both) |
| `<lib dir>/pkgconfig/` | `libcrypto.pc`, `libssl.pc`, `openssl.pc`, relative to the package |

```sh
PKG_CONFIG_PATH=node_modules/@ai-ecoverse/wasix-openssl/lib/pkgconfig \
  wasixcc app.c $(pkg-config --cflags --libs openssl)
```

Configured `linux-generic32 no-asm no-shared no-dso threads` with
`OPENSSL_NO_SECURE_MEMORY` and `OPENSSL_NO_DGRAM`, after
[wasix-org/openssl](https://github.com/wasix-org/openssl)'s `wasix.sh`. Entropy
comes from WASI `random_get`. The default `OPENSSLDIR` is `/etc/ssl`; programs
that verify servers should point `SSL_CERT_FILE` at a CA bundle (in slicc,
the kernel's).

Recipe: [homescoop/packages/wasix-openssl](https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasix-openssl).
