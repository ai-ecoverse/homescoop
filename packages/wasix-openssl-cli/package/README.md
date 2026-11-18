# @ai-ecoverse/wasix-openssl-cli

OpenSSL 3.5.9's `openssl` command for [slicc](https://github.com/ai-ecoverse/slicc)'s
kernel, built for WASIX from the OpenSSL release. Recipe:
[homescoop/packages/wasix-openssl-cli](https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasix-openssl-cli).
The libraries alone, for linking, are `@ai-ecoverse/wasix-openssl`.

```sh
openssl x509 -in cert.pem -text -noout
openssl s_client -connect host:443 -servername host -showcerts </dev/null
openssl verify -CAfile ca.pem cert.pem
openssl asn1parse -in cert.pem
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -keyout key.pem -subj /CN=localhost -days 7 -out cert.pem
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out rsa.pem
openssl dgst -sha256 file
openssl base64 -in file
```

## What works

Every command is OpenSSL's own, with the default provider and the legacy
one built in (`-provider legacy -provider default` for MD4 and the like). These are checked on slicc-kernel 1.186.0, in the browser and on
Node, in both of Node's runtimes: `createNodeKernel()` and
`createNodeKernel({ blocking: 'async', emscripten: 'kernel' })`, the one a
Cloudflare Durable Object runs.

- **Certificates and keys:** `x509` (`-text`, `-noout`, `-ext`,
  `-fingerprint`, `-req -CA`), `req` (CSRs, `-x509`, `-addext`), `genpkey`
  (RSA, EC, Ed25519, ML-DSA, SLH-DSA), `pkey`, `verify` (`-CAfile`,
  `-verify_hostname`, `-purpose`), `asn1parse`, `crl2pkcs7`, `pkcs7`,
  `pkcs12`, `storeutl`.
- **Digests and the rest:** `dgst` (also `-sign` and `-verify`), `base64`,
  `enc`, `rand`, `speed`.
- **Pass phrases:** `-pass pass:…` and the other `-pass` sources, and a
  prompt on a terminal, which doesn't echo.
- **TLS:** `s_server` and `s_client` on the kernel's loopback (TLS 1.3 and
  1.2), `-showcerts`, `-verify_return_error`, and typing to `s_client` on a
  terminal.
- **s_client to other machines** goes through the kernel's normal socket
  calls: the name through `getaddrinfo`, then a TCP connection. That reaches
  what the kernel's uplink routes, such as a tailnet. Without a route it
  fails at once, which is the case today for an agent's computer in a
  Durable Object:

  ```text
  $ openssl s_client -connect 93.184.216.34:443 </dev/null
  …:error:80000028:system library:BIO_connect:Network unreachable:crypto/bio/bio_sock2.c:183:calling connect()
  connect:errno=40
  $ openssl s_client -connect example.com:443 </dev/null
  …:error:10080002:BIO routines:BIO_lookup_ex:system lib:crypto/bio/bio_addr.c:772:Name does not resolve
  ```

  Both exit 1. A refused port is `Connection refused`.
- **Trusted roots.** Each run of `openssl` gets two defaults from the
  package (`slicc.env`; a caller's own value wins):
  - `OPENSSL_CONF` names `etc/ssl/openssl.cnf`, upstream's sample config,
    for `req` and `ca`.
  - `SSL_CERT_DIR` names `etc/ssl/certs`: Mozilla's roots (curl's
    cacert-2026-09-25.pem), one file per certificate named by subject hash.
    So `s_client` and `verify` trust public CAs, and the kernel's own CA in
    `SSL_CERT_FILE` too. The same roots as one bundle are `etc/ssl/cert.pem`
    in the package, for `-CAfile`.

## What doesn't work

- **No DTLS or QUIC.** `s_client -dtls` and `-quic` start, but the
  handshake doesn't finish over the kernel's UDP. `s_client` and `s_server`
  over TCP are what's supported.
- **No threads, engines or loadable modules** (built `no-threads no-engine
  no-dso no-shared`): no `-engine`, no `-provider-path` to load a module, no
  FIPS provider, and `speed -multi` isn't there.
- **No forking:** `ocsp` and `cmp` have no forking HTTP daemon (`-multi`).
- **`-proxy`** goes through the kernel's HTTP proxy, which ends TLS with the
  kernel's own CA. `s_client -proxy 127.0.0.1:3128` therefore shows that
  CA's certificate, not the server's.
- **`s_client` with stdin at its end** (`</dev/null`, a closed pipe) sends
  nothing and closes after the handshake. Pipe the request in, or use
  `-ign_eof` to wait for the answer.
- No hardware or assembler speedups (`no-asm`): `speed` runs the C code.

## Limits

- `bin/openssl.wasm` is about 4.4 MB (1.8 MB packed). Its memory starts at
  16 MiB (8 MiB of it the stack) and doesn't grow for the largest jobs the
  cert runs (an RSA-4096 key, `x509 -text` and `pkcs7` over the 121 roots,
  4 MB through `dgst`); the measured peak is under 10 MiB.
- The module imports no `thread_spawn` and has no `dlopen`, so it runs where
  the kernel has neither. On Cloudflare a process that computes for 30 s
  without a system call is ended; an RSA-4096 key takes about 2 s here.
- `speed` measures for as long as asked: the kernel delivers `SIGALRM` only
  at a system call, and a benchmark loop makes none, so `patches/0001`
  makes the loops also watch the clock.

## Build

Configure `linux-generic32 no-shared no-pic no-asm no-dso no-threads
no-engine no-async no-secure-memory no-afalgeng no-tests no-docs`, with
`-DHAVE_FORK=0` and `-DNO_RECVMMSG -DNO_RECVMSG` (WASIX has no `CMSG`
macros, so `BIO_dgram` uses `recvfrom`), on wasixcc and
`@ai-ecoverse/wasix-sysroot` 2025.9.30-44 (static, no wasm exceptions, no
asyncify). `openssl version -a` prints the options.

Licences: OpenSSL is Apache-2.0 (`LICENSE`). wasix-libc, which it links
statically, and Mozilla's roots (MPL-2.0) are in `THIRD-PARTY-NOTICES.md`.
Sources and the patch: `SOURCES.md`, `patches/`.
