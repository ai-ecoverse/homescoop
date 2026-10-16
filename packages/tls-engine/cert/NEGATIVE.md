# Negative proof (tls-engine)

**Date:** 2026-10-16. The first `cert/` for tls-engine (homescoop#426), with
the move to Mbed TLS 4.2.0 (#270). Run locally with slicc-kernel 1.100.3 (the
root `package.json` pin; the same results on 1.94.0, and on 1.100.3 with
`--users enforce`), wasm-curl 8.22.0-4 and wasm-coreutils 9.12.0-7, against
a `host-run.sh` build of 4.2.0-1 (emsdk 4.0.23). Not in
`scripts/ci-certified.json`.

`realm-proxy.mjs` is the kernel spec (the realm proxy terminating curl's
tunnels with the tarball under test); `lib/engine-api.mjs` is the `ci:`
command (Node's TLS client against the engine's own API).

## The published 3.6.7-1 passes both

```
browser-cert: ok packages/tls-engine/cert/realm-proxy.mjs
ℹ tests 17  ℹ pass 17  ℹ fail 0
```

That is the point of the port: the API and its behaviour must not change for
slicc. The one difference the specs see is the error code of a refused leaf
certificate: 3.6.7-1 returns `-20352 ECP - Bad input parameters to function`,
4.2.0-1 `-16128 PK - Type mismatch, eg attempt to encrypt with an ECDSA key`.
Both are named, and both are < 0.

## The 3.6.7 engine against Mbed TLS 4.2.0

`src/slicc_tls_engine.c` as it was on main doesn't compile:

```
old_engine.c:25:10: fatal error: 'mbedtls/ctr_drbg.h' file not found
```

(ctr_drbg.h, entropy.h and ecp.h are private in TF-PSA-Crypto;
`mbedtls_ssl_conf_rng`, `mbedtls_pk_setup`, `mbedtls_pk_ec` and
`mbedtls_ecp_gen_key` are gone.)

## Known-bad builds of 4.2.0

**Empty wasm** (`dist/slicc-tls-engine.wasm` truncated to 0 bytes). The
kernel treats an engine that doesn't load as no engine:

```
browser-cert: FAIL packages/tls-engine/cert/realm-proxy.mjs
curl: (7) CONNECT tunnel failed, response 501
```

and the factory fails in `engine-api.mjs`'s `before`, so all 17 are
cancelled (exit 1):

```
Aborted(CompileError: WebAssembly.instantiate(): BufferSource argument is empty)
ℹ pass 0  ℹ cancelled 17
```

**TF-PSA-Crypto's default entropy** (no `tls_engine_crypto_config.h`, so
`MBEDTLS_PSA_BUILTIN_GET_ENTROPY`). With the engine's own
`mbedtls_platform_get_entropy` the link fails (`duplicate symbol:
mbedtls_platform_get_entropy`, also in `platform_util.c.o`). Without it, the
build links and the built-in source finds nothing in a page or worker:
`psa_crypto_init` fails, so no leaf and no handshake:

```
browser-cert: FAIL packages/tls-engine/cert/realm-proxy.mjs
curl: (35) ssl_handshake returned: (-0x7280) SSL - The connection indicated an EOF
✖ a leaf is a P-256 key pair; only its SubjectPublicKeyInfo leaves the engine
  AssertionError [ERR_ASSERTION]: tls_leaf_new: PSA - Insufficient entropy
ℹ pass 1  ℹ fail 16
```

(the one pass is the factory and its exports.)

**The port without the engine's error names** (`tls_strerror` straight to
4.2.0's `mbedtls_strerror`, which names TLS and X.509 errors only):
`realm-proxy.mjs` passes, `engine-api.mjs` fails:

```
✖ a leaf certificate for another key is refused, and a leaf without one has no session
  AssertionError [ERR_ASSERTION]: tls_strerror does not name -16128: UNKNOWN ERROR CODE (3F00)
```

## The specs aren't vacuous

- `realm-proxy.mjs` pins each TLS version and checks curl's verbose
  handshake line (`mbedTLS: TLSv1.3 Handshake complete`, `TLSv1.2`), the
  leaf's subject, issuer (the kernel CA) and key size, exact bodies, a
  300000-byte download by sha256 and a 170824-byte upload hashed by the far
  end, two requests on one tunnel, and rc 60 for a CA that didn't sign the
  leaf (with `-k` going through, so the failure is the chain).
- `engine-api.mjs` checks every export `index.d.ts` names, the leaf's SPKI
  (P-256, a new key each time), Node's verification (`authorized`, SAN,
  issuer, ALPN `http/1.1`) and the engine's own view (`tls_version`,
  `tls_alpn_http11`, `tls_handshake_done`), byte-exact 1 MiB transfers both
  ways, close_notify, `TLS_EOF`, 300 live leaves, no heap growth over 1500
  leaf/session cycles, and six refusals: another key's certificate (named
  by `tls_strerror`), no chain (`TLS_BADARG`), another host's SNI, an
  untrusted CA, an expired leaf, and plaintext instead of a ClientHello.

## The consumers' own tests (not part of this cert)

The 4.2.0-1 build also passes, unchanged:

- ai-ecoverse/slicc `packages/webapp/tests/kernel/wasm-realm/net/`
  (vitest; `tls-tunnel.test.ts` 14/14, 162 passed, 1 skipped, the same as
  the 3.6.5-1 slicc pins).
- ai-ecoverse/slicc-kernel `test/integration/network.test.mjs`,
  `local-proxy.test.mjs`, `dns-rebinding.test.mjs`, `node-loopback.test.mjs`
  and `node.test.mjs` (the registry over https, pnpm installs through the
  realm proxy), with the engine replaced by 4.2.0-1. The one `node.test.mjs`
  case not run needs wasix-python, which was not installed (no TLS).
