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

## The published 3.6.7-1

`realm-proxy.mjs` passes, and so do 18 of the 19 cases of `engine-api.mjs`:
the API and its behaviour mustn't change for slicc. The one that fails is the
entropy case (#551). When `crypto.getRandomValues` throws, 3.6.7-1 lets the
exception unwind through the wasm and out of `tls_leaf_new`. 4.2.0-1 catches
it in `slicc_random` and returns 0 with `PSA - Insufficient entropy`, and the
same instance makes a leaf once entropy is back:

```
✖ no entropy is an error, not a JS throw, and a fresh instance recovers (#551)
  Error: no entropy
ℹ tests 19  ℹ pass 18  ℹ fail 1
```

(The 4.2.0-1 build before the catch, at a38dbcce, fails the same way. Under
TF-PSA-Crypto, the throw also left `psa_crypto_init` half done, so that
instance never made a leaf again.)

The specs see one other difference: the error code of a refused leaf
certificate. 3.6.7-1 returns `-20352 ECP - Bad input parameters to function`
and 4.2.0-1 returns `-16128 PK - Type mismatch, eg attempt to encrypt with an
ECDSA key`. Both are named, and both are < 0.

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

and the factory fails in `engine-api.mjs`'s `before`, so all 19 are
cancelled (exit 1):

```
Aborted(CompileError: WebAssembly.instantiate(): BufferSource argument is empty)
ℹ pass 0  ℹ cancelled 19
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
ℹ pass 1  ℹ fail 18
```

(the one pass is the factory and its exports.)

**The port without the engine's error names** (`tls_strerror` straight to
4.2.0's `mbedtls_strerror`, which names TLS and X.509 errors only):
`realm-proxy.mjs` passes, `engine-api.mjs` fails:

```
✖ a leaf certificate for another key is refused, and a leaf without one has no session
  AssertionError [ERR_ASSERTION]: tls_strerror does not name -16128: UNKNOWN ERROR CODE (3F00)
ℹ pass 17  ℹ fail 2
```

(The other failure is the entropy case: that build predates the catch.)

## The specs aren't vacuous

- `realm-proxy.mjs` pins each TLS version and checks curl's verbose
  handshake line (`mbedTLS: TLSv1.3 Handshake complete`, `TLSv1.2`), the
  leaf's subject, issuer (the kernel CA) and key size, exact bodies, a
  300000-byte download by sha256 and a 170824-byte upload hashed by the far
  end, two requests on one tunnel, and rc 60 for a CA that didn't sign the
  leaf (with `-k` going through, so the failure is the chain).
- `engine-api.mjs` checks every export `index.d.ts` names, that no entropy
  is an error code (not a throw) that a fresh instance recovers from, the leaf's SPKI
  (P-256, a new key each time), Node's verification (`authorized`, SAN,
  issuer, ALPN `http/1.1`) and the engine's own view (`tls_version`,
  `tls_alpn_http11`, `tls_handshake_done`), the whole chain going out (a
  client that trusts only the root accepts a leaf from an intermediate the
  engine sends, and refuses it without), byte-exact 1 MiB transfers both
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

## 4.2.0-2: client sessions (slicc-kernel#922)

**Date:** 2026-10-17. The base is homescoop origin/main 50f524c, with `host-run.sh` builds (emsdk 4.0.23).

- **The published 4.2.0-1** has no client API. `lib/client-api.mjs` fails before its first case: `TypeError: this.m._tls_ca_new is not a function`.
- **A 4.2.0-2 build with the hostname check removed** (`mbedtls_ssl_set_hostname(&s->ssl, NULL)` for every server name) fails 4 of the 15 cases of the first head's `lib/client-api.mjs`:
  - **the wrong-hostname row is accepted** instead of refused;
  - TLS 1.3 and 1.2 send no SNI;
  - the insecure-flag row no longer reports CN_MISMATCH.

```
✖ TLSv1.3: the chain verifies, ALPN agrees, the peer chain reads back, and 1 MiB goes each way
✖ TLSv1.2: the chain verifies, ALPN agrees, the peer chain reads back, and 1 MiB goes each way
✖ refused: a leaf for another host name
✖ TLS_CLIENT_INSECURE_SKIP_VERIFY finishes the handshake and still reports the result
ℹ pass 11  ℹ fail 4
```

- **3990d82, the first head of #1022,** fails the two cases added for the cert-review findings: `TLS 1.3: a response buffered behind the NewSessionTickets comes out without more input` (homescoop#1032; `tls_read` returns 0 with the response buffered, and nothing more arrives) and `an absolute name (one trailing dot)` (homescoop#1033; CN_MISMATCH). It passes the other 15.

```
✖ TLS 1.3: a response buffered behind the NewSessionTickets comes out without more input, and the connection stays open (homescoop#1032)
✖ an absolute name (one trailing dot) is the same host for SNI and the check (homescoop#1033)
ℹ pass 15  ℹ fail 2
```

- **4.2.0-2 as built:** `lib/client-api.mjs` passes 17/17, and `lib/engine-api.mjs` passes 19/19 unchanged, so the server ABI is untouched. The tarball is byte-identical over two builds.

## 4.2.0-3: client certificates, the ciphersuite, no SNI, chain-only (slicc-kernel#1004)

**Date:** 2026-10-17. The base is homescoop origin/main 2167761.

- **The published 4.2.0-2** fails the 6 new cases of `lib/client-api.mjs` (17 of 23 pass): it has no `tls_ciphersuite`, `tls_client_cert` or `tls_name_mismatch`, and `tls_client_new` refuses flags 2 and 4.

```
✖ TLSv1.3: tls_ciphersuite gives the IANA number of the suite the server picked (#1004)
✖ TLSv1.2: tls_ciphersuite gives the IANA number of the suite the server picked (#1004)
✖ a client certificate: a server that requires one accepts it and sees its subject, refuses without, and the key bytes are wiped (#1004)
✖ a client key: DER, encrypted PEM with its passphrase; refused: … (#1004)
✖ TLS_CLIENT_NO_SNI sends no SNI and still refuses a leaf for another host (#1004)
✖ TLS_CLIENT_VERIFY_CHAIN_ONLY skips only the name: … (#1004)
ℹ pass 17  ℹ fail 6
```

- **4.2.0-3 as built:** `lib/client-api.mjs` passes 23/23 and `lib/engine-api.mjs` 19/19 (the server ABI is unchanged).

- **The NO_SNI fail-open (Codex P1 on #1089):** a build of this head without the fail-closed line (`if (ret != 0 && ret != MBEDTLS_ERR_X509_CERT_VERIFY_FAILED) return 1;`) fails `TLS_CLIENT_NO_SNI sends no SNI and still refuses a leaf for another host`. With `tls_test_name_check_error(s, PSA_ERROR_INSUFFICIENT_MEMORY)` the nested check can't run, `found` stays 0, and the handshake is accepted. With the line, it's refused with CN_MISMATCH.
