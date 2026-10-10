# Negative proof (wasix-openssl)

**Date:** 2026-10-10 (3.5.9-1)
New package, so it needs human cert first.

`node scripts/wasix-lib-cert.mjs wasix-openssl --tarball <tgz>` on slicc-kernel
1.35.1's Node entry. Probes are compiled with nothing but `pkg-config openssl`
from the flavour's own `.pc` files and linked with `-Wl,--fatal-warnings`. The
good tarball passes with both `sslprobe` (static-main, `lib/`) and
`sslprobe-pic` (dynamic-main, `lib-pic/`).

## A flavour missing an object

The same tarball with `libssl-lib-ssl_lib.o` deleted from `lib-pic/libssl.a`:
the PIC probe does not link.

```text
wasm-ld: error: …/package/lib-pic/libssl.a(libssl-lib-rec_layer_s3.o): undefined symbol: SSL_set_shutdown
wasm-ld: error: …/package/lib-pic/libssl.a(libssl-lib-rec_layer_s3.o): undefined symbol: ssl_get_max_send_fragment
```

## The probe's own negatives

Each run also has to see failures where they belong: AES-256-GCM decrypt with a
flipped tag bit, and ECDSA P-256 / RSA-2048 verify of a tampered message, must
all fail; `RAND_bytes` must return different non-zero blocks.

## ABI (the wasix-zlib 1.3.1-1 lesson)

`-Wl,--fatal-warnings` turns wasm-ld's "function signature mismatch" (which
otherwise links a trapping stub) into a link error. The probe calls BIO
functions whose signatures carry `long`, `size_t` and file offsets
(`BIO_seek`/`BIO_tell` on a file BIO, `BIO_get_mem_data`, `BIO_ctrl_pending`,
`BIO_ctrl`), against the shipped `opensslconf.h`/`configuration.h` (one
`include/` for both flavours; build.sh fails if the two builds generate
different headers).
