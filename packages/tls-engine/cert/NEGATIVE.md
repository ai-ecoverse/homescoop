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

- **The NO_SNI fail-open (Codex P1 on #1089):** a build of this head without the fail-closed line (`if (ret != 0 && ret != MBEDTLS_ERR_X509_CERT_VERIFY_FAILED) return 1;`) fails `TLS_CLIENT_NO_SNI sends no SNI and still refuses a leaf for another host`. With `tls_test_name_check_error(s)` (which injects MBEDTLS_ERR_X509_ALLOC_FAILED; it takes no code, so it can't inject 0 or CERT_VERIFY_FAILED) the nested check can't run, `found` stays 0, and the handshake is accepted. With the line, it's refused with CN_MISMATCH.

## 4.2.0-4: tls_last_alert (slicc-kernel#1004)
- **4.2.0-3 (the published tgz):** `lib/client-api.mjs` fails `tls_last_alert: the server's fatal alert …`, because there's no `_tls_last_alert` export. The other 23 cases pass.
- **4.2.0-4 as built:** client-api 24/24 and engine-api 19/19 (the server ABI is unchanged).

## 4.2.0-5: tls_chain_verify (slicc-kernel#1090)
- **4.2.0-4 (the published tgz):** `lib/client-api.mjs` fails the five `tls_chain_verify …` cases, because there's no `_tls_chain_verify` export. The other 24 cases pass.
- **A build without the fail-closed line at entry** (`*flags_out = TLS_CHAIN_UNVERIFIED;`) fails `fails closed: a NULL store, no chain, a truncated DER, garbage and an allocation failure are < 0 with flags that are never 0`. The error paths then leave the caller's flags at 0, which reads as verified. With the line it passes.
- **A build that returns 0 for a verification that failed** (the review's case, `return 0;` instead of `return flags == 0 ? 0 : 1;`) fails three cases on the return code (wrong host, untrusted/expired/clientAuth, the IP literal against a dNSName), so a caller that checks only `== 0` is covered.
- **4.2.0-5 as built:** client-api 29/29 and engine-api 19/19 (the server and client session ABIs are unchanged; the session's name parsing and IP-SAN check now go through the same `name_parse` and `ip_name_flags` as `tls_chain_verify`).

## 4.2.0-6: the burn-down (homescoop#1042, #1091, #1121; 2026-10-20)

`node --test packages/tls-engine/cert/lib/client-api.mjs` against the published 4.2.0-5 fails the three new tests:

```text
✖ an RSA client key in PKCS#8 … (homescoop#1121)
  AssertionError: PKCS#8 DER: HMAC_DRBG - Too many random requested in single call
✖ a server name is its bytes: tls_client_new_name refuses one with a NUL inside … (homescoop#1042)
  TypeError: engine.m._tls_client_new_name is not a function
✖ tls_strerror names the engine's own codes … (homescoop#1091)
```

- **#1121:** `mbedtls_pk_check_pair` refuses an RSA key parsed from PKCS#8 under Mbed TLS 4's PSA-backed pk, though the key matches the leaf. 4.2.0-6 then compares the public key the private key carries with the leaf's, as DER SubjectPublicKeyInfo. A key for another certificate still differs there, and is refused at `tls_client_cert` with `TLS_BADARG`, which the kernel maps to `ERR_OSSL_X509_KEY_VALUES_MISMATCH`.
- **#1091:** the engine's -1, -2 and -3 are also Mbed TLS's HMAC_DRBG codes, which `mbedtls_strerror` named instead. `crypto_strerror` now names the engine's codes first.
- **#1042:** the C-string API can't see a NUL. The new `tls_client_new_name` takes the length, so slicc-kernel's binding (zzy4) can switch to it, and refuses a NUL inside the name.

All 32 client-api and 19 engine-api tests pass on 4.2.0-6.

## 4.2.0-7: RSA client keys up to 8192 bits (homescoop#1376; 2026-10-21)

The base is homescoop origin/main 184a0310, with a `host-run.sh` build.

`node --test packages/tls-engine/cert/lib/client-api.mjs` against the published 4.2.0-6 fails the new test. RSA-4096 loads and authenticates there, and RSA-8192 is refused:

```text
✖ RSA client keys of 4096 and 8192 bits load and authenticate; a certificate with an RSA key over 8192 bits is refused with TLS_RSA_TOO_LARGE (homescoop#1376)
  AssertionError [ERR_ASSERTION]: RSA-8192 PKCS#1 DER: -15104 PK - The pubkey tag or value is invalid (only RSA and EC are supported)
```

- **The cause:** TF-PSA-Crypto 4.2.0 defines `PSA_VENDOR_RSA_MAX_KEY_BITS` as 4096 in `include/psa/crypto_sizes.h`, with no `#ifndef`, so the user config can't raise it. Importing an RSA key above it fails, and PK reports that as an invalid public key. `rsa-max-key-bits-8192.patch` sets it to 8192. That's the most `MBEDTLS_MPI_MAX_SIZE` (1024 bytes) holds, so a larger key can't be parsed anyway. The engine asserts the value at compile time, so a build without the patch fails.
- **Above 8192 bits,** a leaf whose RSA key is too large is refused at `tls_client_cert` with the engine's `TLS_RSA_TOO_LARGE`, not with PK's misleading text. The engine reads the modulus size from the certificate's SubjectPublicKeyInfo only after Mbed TLS refused it.
- **4.2.0-7 as built:** client-api 33/33 and engine-api 19/19. The wasm grows by 539 bytes (315940 to 316479).

## 4.2.0-8: server sessions with the caller's key, chain, ALPN and client certificates (homescoop#1638; 2026-10-22)

The base is homescoop origin/main 2aa7669c, with `host-run.sh` builds (emsdk 4.0.23).

- **The published 4.2.0-7** (`npm pack @ai-ecoverse/wasm-tls-engine@4.2.0-7`) has none of the new calls. `lib/server-api.mjs` fails in its `before` hook, so all 14 cases are cancelled and `node --test` exits 1:

```text
AssertionError [ERR_ASSERTION]: 4.2.0-7 has no _tls_leaf_import
ℹ tests 14  ℹ pass 0  ℹ fail 0  ℹ cancelled 14
```

- **A build with `TLS_SERVER_REQUIRE_CERT` mapped to Mbed TLS's `VERIFY_OPTIONAL`** (a server that asks for a certificate but takes a handshake without one) fails both client-certificate cases, on TLS 1.3 and 1.2:

```text
✖ client certificates over TLSv1.3: REQUIRE_CERT refuses a client without one, …
  AssertionError [ERR_ASSERTION]: REQUIRE_CERT with no certificate was served
✖ client certificates over TLSv1.2: REQUIRE_CERT refuses a client without one, …
ℹ pass 12  ℹ fail 2
```

- **4.2.0-8 as built:** server-api 14/14, and engine-api 19/19 and client-api 33/33 unchanged (the MITM `tls_leaf_new`/`tls_session_new` path and the client sessions behave as before; `tls_client_cert` now shares its parsing and key-match code with `tls_leaf_import`). The wasm grows by 663 bytes (316479 to 317142).

## 4.2.0-9: refusal alerts (homescoop#1765) and SELECT after the ClientHello (homescoop#1766; 2026-10-23)

The base is homescoop origin/main ec2b7f3d, with `host-run.sh` builds (emsdk 4.0.23), Node 26 and OpenSSL 4.0.3's `openssl s_client`.

- **The published 4.2.0-8** (`npm pack @ai-ecoverse/wasm-tls-engine@4.2.0-8`, sha256 beb44dc7…) fails every #1765 case but the six whose alert it already sent (TLS 1.2 with a bad certificate, to s_client and Node, and the ALPN mismatches), and the #1766 block in its `before` hook (no `_tls_server_select`), so `node --test packages/tls-engine/cert/lib/server-api.mjs` exits 1:

```text
✖ REQUIRE_CERT over TLSv1.3, no certificate: openssl s_client reads alert 116, never a bad record MAC
  807F2EFD01000000:error:0A000119:SSL routines:tls_get_more_records:decryption failed or bad record mac
✖ REQUIRE_CERT over TLSv1.3, no certificate: Node's tls.connect fails with alert 116
  ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC
✖ REQUIRE_CERT over TLSv1.2, no certificate: openssl s_client reads alert 40, never a bad record MAC
  error:0A000126:SSL routines::unexpected eof while reading
✖ REQUIRE_CERT over TLSv1.2, no certificate: Node's tls.connect fails with alert 40
  ECONNRESET
✖ the engine's own client: tls_last_alert is 116 on the read after a TLS 1.3 handshake without a certificate, …
✖ SELECT: the leaf and ALPN chosen after the ClientHello (homescoop#1766)
  AssertionError [ERR_ASSERTION]: no _tls_server_select
ℹ tests 40  ℹ pass 20  ℹ fail 9  ℹ cancelled 11
```

- **The 4.2.0-9 engine without `server-refusal-alerts.patch`** fails the same eight #1765 cases and the engine-client one, plus SELECT|REQUIRE_CERT (its 116), so the patch is what fixes them: `ℹ tests 40  ℹ pass 30  ℹ fail 10`.
- **The causes:**
  - **TLS 1.3:** Mbed TLS 4.2.0's server switches its outbound keys to the application traffic keys only at the handshake's end, after the client's Finished. RFC 8446 §7.1 has it send under them from its own Finished on, and the client reads them from there, so an alert refusing the client's Certificate, CertificateVerify or Finished was undecryptable. The patch switches them in `ssl_tls13_write_server_finished` and skips the second switch in `mbedtls_ssl_tls13_handshake_wrapup`, which would reset the record sequence number. A missing certificate was also alert 41 (no_certificate, SSL 3 only); it's 116 now.
  - **TLS 1.2:** `mbedtls_ssl_parse_certificate` returned `NO_CLIENT_CERTIFICATE` without pending an alert; the patch pends 40 (handshake_failure).
- **#1766:** 4.2.0-8 has no `tls_server_select`, `tls_server_refuse` or `tls_client_alpn`, and `tls_server_new` refuses flags 4. The refused-flags case of #1638 now tries 7, 8 and `REQUIRE_CERT | 4` without `client_ca` instead of 4.
- **4.2.0-9 as built:** server-api 40/40 (14 from 4.2.0-8, 15 for #1765, 11 for #1766), client-api 33/33, engine-api 19/19. The wasm grows by 2314 bytes (317142 to 319456).

## 4.2.0-10: NSS key log lines (homescoop#1774; 2026-10-23)

The base is homescoop origin/main 3617e1e0, with `host-run.sh` builds (emsdk 4.0.23), Node 26.11.1 and OpenSSL 4.0.3's `openssl s_client`.

- **The published 4.2.0-9** (`npm pack @ai-ecoverse/wasm-tls-engine@4.2.0-9`, sha256 08365fdc5b06ea75230d40d4a5a5af456dafc57c152a1cd6c6dc8eded8f594c3) fails `keylog.mjs` in its `before` hook, so all 12 cases are cancelled and `node --test packages/tls-engine/cert/lib/keylog.mjs` exits 1:

```text
AssertionError [ERR_ASSERTION]: 4.2.0-9 has no _tls_keylog
ℹ tests 12  ℹ pass 0  ℹ fail 0  ℹ cancelled 12
```

  Flag 8 isn't ignored there either: `tls_client_new(…, 8)` and `tls_server_new(0, 0, 0, 0, SELECT | 8)` return 0 with `TLS_BADARG`.
- **The 4.2.0-10 engine without the zeroing on drain** (the tail of the buffer left as it was) fails the drain case: `the buffer is zero after a drain`. **Without the zeroing in `tls_session_free`** it fails the same case at `no copy left: the drain zeroed the client's lines and tls_session_free the server's` (the freed session's lines are still in the heap). `ℹ pass 11  ℹ fail 1` each.
- **Refused-flag cases:** 8 is now `TLS_KEYLOG`, so the unknown-bit cases of `client-api.mjs` try 16 and `32 | NO_SNI` (was 8 and `16 | NO_SNI`) and 16 (was 8), and `server-api.mjs`'s #1638 case tries 16 (was 8).
- **4.2.0-10 as built:** keylog 12/12, server-api 40/40, client-api 33/33, engine-api 19/19. The wasm grows by 850 bytes (319456 to 320306).
