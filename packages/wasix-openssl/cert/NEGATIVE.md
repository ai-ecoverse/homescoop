# Negative proof (wasix-openssl)

**Date:** 2026-10-10 (3.5.9-1; 3.5.9-2 pins the build date)
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

## Reproducibility (3.5.9-2)

Two CI builds of 3.5.9-1 from the same source (runs 38021434702 and
38022316254) differed in one archive member out of 1009 per libcrypto.a,
`libcrypto-lib-cversion.o`: OpenSSL's build date (`built on: Sat Oct 10
03:42:45 2026 UTC` vs `03:58:09`). 3.5.9-2 sets `SOURCE_DATE_EPOCH` to the
3.5.9 release (Tue Sep 29 14:10:08 2026 UTC); build.sh refuses a
libcrypto.a without that string, and the probe asserts
`OpenSSL_version(OPENSSL_BUILT_ON)` equals it.

## 3.5.9-3 (threads)

3.5.9-2 (Configure with `-static`, so threads disabled), same probe, slicc-kernel 1.35.1's Node entry:

```
sslprobe: rc=134
OpenSSL 3.5.9 29 Sep 2026
sslprobe: wasm trap in thread 2: memory access out of bounds
sslprobe: wasm trap in thread 3: memory access out of bounds
```

Its configuration.h has no `OPENSSL_THREADS`; CPython's `_ssl.c` / `_hashopenssl.c` refuse to compile against it.

