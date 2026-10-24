# @ai-ecoverse/wasm-tls-engine

TLS for [SLICC](https://github.com/ai-ecoverse/slicc): Mbed TLS 4.2.0 sessions over memory buffers, compiled with Emscripten to an ES module factory plus `slicc-tls-engine.wasm`.
- **Server sessions** serve SLICC's wasm-realm HTTP proxy (ai-ecoverse/slicc#3571).
- **Client sessions** verify a server, for slicc-kernel's raw TLS (ai-ecoverse/slicc-kernel#922).
- Both are in one wasm, loaded lazily by its callers.

## Server sessions

- The engine holds **no CA key**. `tls_leaf_new` generates a P-256 key pair, and `tls_leaf_spki` hands out only its public key. The caller builds and signs the leaf certificate and gives the chain back with `tls_leaf_add_cert`.
- There's one session per CONNECT tunnel (`tls_session_new(leaf, host)`), and a client's SNI must name `host`. ALPN offers `http/1.1` only. TLS 1.2 and 1.3.

### A program's own TLS server (4.2.0-8, homescoop#1638)

- **`tls_leaf_import(chain, chain_len, key, key_len, pass, pass_len)`** makes a leaf from the caller's chain (concatenated DER, its leaf first) and private key; 0 on failure, with `tls_last_error`.
  - The key is parsed exactly as `tls_client_cert` parses it: PEM (the NUL counted in `key_len`) or DER, PKCS#8, SEC1 or PKCS#1, optionally encrypted with `pass` (`0, 0` for none); RSA up to 8192 bits and the NIST EC curves.
  - It's refused with the same errors: `TLS_BADARG` for a key that doesn't match the leaf (and for an empty chain or key), `TLS_RSA_TOO_LARGE` for a chain certificate with an RSA key over 8192 bits, and Mbed TLS's own PK error for a wrong or missing passphrase. No error text holds key or passphrase bytes.
  - As with `tls_client_cert`, the engine wipes the key and passphrase bytes it was given, whether the import succeeds or not; it keeps its own copy, zeroized when the leaf goes.
  - The leaf serves any number of sessions. It's refcounted like `tls_leaf_new`'s: `tls_leaf_free` drops the caller's reference, and each session holds its own.
- **`tls_server_new(leaf, alpn, alpn_len, client_ca, flags)`** is a server session with no requirement on the client's SNI. It works with any leaf whose chain is set: an imported one, or `tls_leaf_new` plus `tls_leaf_add_cert`.
  - **ALPN:** `alpn` is a wire-format list (length-prefixed names) in the server's order of preference; `0, 0` offers none. When the client offers several, the server's first one the client also offers wins. A client that offers ALPN but none of the server's protocols fails the handshake with a `no_application_protocol` alert (RFC 7301, Mbed TLS's behaviour). A client that offers none, or a server with no list, agrees none (`tls_alpn` gives 0). A malformed list is `TLS_BADARG`.
  - **Client certificates:** with `client_ca` (a `tls_ca_new` store), `TLS_SERVER_REQUEST_CERT` (1) asks for one and lets the handshake finish without one, or with one that doesn't verify; `tls_verify_result` then says what verification found, and the caller decides. `TLS_SERVER_REQUIRE_CERT` (2) fails the handshake without a certificate that verifies against `client_ca` (the chain, validity, and clientAuth when the certificate lists extended key usages). With flags 0 no certificate is asked for, whether `client_ca` is set or not. A flag without `client_ca`, both flags together, or any bit other than these, `TLS_SERVER_SELECT` (4, below) and `TLS_KEYLOG` (8, under Both sides) is `TLS_BADARG`, so a server can't think it requires certificates when it doesn't. The session holds a reference on `client_ca`.
  - TLS 1.2 and 1.3, as `tls_session_new`. The I/O calls, `tls_handshake`, `tls_alpn`, `tls_version`, `tls_ciphersuite`, `tls_peer_count`/`tls_peer_der` (the client's chain) and `tls_verify_result` (the client certificate's flags) work on it. `tls_client_cert` on a server session is `TLS_BADARG`.
- **`tls_sni(session, out, max)`** gives the server name the client sent, at the start of `out`: its length, 0 when the client sent none (or before the ClientHello), or `TLS_BADARG` when `max` is too small. A server session refuses an SNI of 256 bytes or more (the handshake fails). On a `tls_session_new` session it's the host the SNI had to name.

### Refusal alerts (4.2.0-9, homescoop#1765)

A server session that refuses a client sends an alert the client can read, on both versions:
- **TLS 1.3:** after its Finished, a server sends under its application traffic keys (RFC 8446 §7.1). Mbed TLS 4.2.0 kept sending under its handshake keys until the client's Finished came, so an alert refusing the client's certificate was a record the client couldn't decrypt: OpenSSL said "decryption failed or bad record mac", and the engine's own client "Verification of the message MAC failed". `server-refusal-alerts.patch` switches the server's outbound keys right after its Finished (and not again at the handshake's end, which would reset the record sequence number). A missing certificate is now alert 116 (certificate_required), where Mbed TLS sent 41 (no_certificate, an SSL 3 alert TLS 1.3 doesn't define). A certificate that doesn't verify is Mbed TLS's alert for the reason, such as 48 (unknown_ca) or 43 (unsupported_certificate) for a serverAuth-only one.
- **TLS 1.2:** Mbed TLS sent nothing when `TLS_SERVER_REQUIRE_CERT` found no client certificate. The patch sends 40 (handshake_failure), as OpenSSL does (RFC 5246 §7.4.6). A certificate that doesn't verify already got its alert.
- An ALPN mismatch is 120 (no_application_protocol) on both, as before.

### Choosing the leaf and ALPN after the ClientHello (4.2.0-9, homescoop#1766)

For Node's `SNICallback` and `ALPNCallback`: a `tls_server_new` session with `TLS_SERVER_SELECT` (4) pauses once the client's ClientHello is in, before any leaf or ALPN is used.
- **Creating one:** `leaf` may be 0 (one is chosen later), and `alpn` must be `0, 0` (`TLS_BADARG` otherwise: the selection sets it). It combines with `TLS_SERVER_REQUEST_CERT` or `TLS_SERVER_REQUIRE_CERT` as before.
- **The pause:** `tls_handshake` returns 0 while the ClientHello is incomplete, then 2 ("select"). `tls_read` and `tls_write` return `TLS_SELECT_PENDING` (-4) while it waits. Nothing is sent before the selection.
- **What the client asked for:** `tls_sni` gives the SNI (0 for none), and `tls_client_alpn(session, out, max)` the client's ALPN offer as a wire-format list (length-prefixed names, in the client's order): its length, 0 for no offer, `TLS_BADARG` when `max` is too small. Both stay readable after the handshake. On other sessions `tls_client_alpn` gives 0.
- **`tls_server_select(session, leaf, alpn, alpn_len)`** sets the leaf (0 keeps `tls_server_new`'s; the session takes a reference, as `tls_server_new` does) and the one ALPN protocol to agree (`alpn` is the name's bytes, not a list), or none (`0, 0`), even when the client offered some. Then drive `tls_handshake` on. A name the client didn't offer (or one with a NUL byte), no leaf at all, a leaf without a chain, or a call when the session isn't paused is `TLS_BADARG`, and the session stays paused.
- **`tls_server_refuse(session, alert)`** ends a paused session with a fatal alert: 112 (unrecognized_name), 120 (no_application_protocol), 40 (handshake_failure), 49 (access_denied) or 80 (internal_error). Drain `tls_out`; the session's calls then fail. Any other alert, or a session that isn't paused, is `TLS_BADARG`.
- **How it reads the ClientHello:** Mbed TLS has no ALPN callback, so the engine reads the ClientHello itself from the bytes fed in, without consuming them, then lets Mbed TLS parse the same bytes once the selection is made. It reassembles a ClientHello split across records (up to 32 KiB) and checks its framing. A ClientHello it can't read is refused with the alert Mbed TLS would send: 10 (unexpected_message) for a record that isn't a handshake or a handshake message that isn't a ClientHello, 22 (record_overflow) for a record over 16 KiB, 70 (protocol_version) for a non-TLS record version, 47 (illegal_parameter) for two SNI or two ALPN extensions, 112 for an SNI of 256 bytes or more, and 50 (decode_error) for any other malformed field. It fails closed: no ClientHello reaches Mbed TLS without a selection.
- **A cross-check:** Mbed TLS's certificate callback, after its own parse of the ClientHello, compares its SNI and its agreed ALPN with what the engine read and the caller selected, and fails the handshake (40) on any difference. That covers a TLS 1.3 HelloRetryRequest too: the second ClientHello must carry the same SNI, and there's no second pause.

## Client sessions

- **The trust store is the caller's.** `tls_ca_new` makes an empty store. `tls_ca_add_der` adds one DER root, and `tls_ca_add_bundle` adds concatenated DER, such as the package's `roots.der`, returning how many roots it added. On an error (< 0) it may have added the roots before the bad one, so discard that store. The engine never loads roots by itself.
- **Starting a session:** `tls_client_new(ca, servername, alpn, alpn_len, flags)` starts one. It takes the server name as a C string, an ALPN list in wire format (length-prefixed names; `0, 0` for none) and flags. `tls_client_new_name(ca, servername, servername_len, alpn, alpn_len, flags)` (since 4.2.0-6) is the same with the name's length given: a NUL byte inside the name is refused (`TLS_BADARG`), where the C-string form would end the name at it. Use it for names that come from JS.
  - **Verification is required.** The chain must reach a root in `ca`, the leaf must name the server, every certificate must be within its validity period by the clock, and the leaf must allow server use (extendedKeyUsage serverAuth and keyUsage).
  - Without a store, or with an empty server name, there's no session (`TLS_BADARG`).
  - **Flags:**
    - `TLS_CLIENT_INSECURE_SKIP_VERIFY` (1) lets the handshake finish whatever the chain says. `tls_verify_result` still reports what verification found.
    - `TLS_CLIENT_NO_SNI` (2) sends no SNI. The name is still checked exactly as with SNI: by Mbed TLS's own check, after the trailing-dot strip, and an IP literal only against an iPAddress SAN.
    - **`TLS_CLIENT_VERIFY_CHAIN_ONLY` (4) skips the hostname check. The caller MUST check the server's identity itself**, for example with Node's `checkServerIdentity` on `tls_peer_der(s, 0)`. Chain, validity and key usage are still required, and SNI is still sent. `tls_name_mismatch` gives the skipped check's result, so a mismatch is reported, not silent.
    - Only 0, 1, 2, 4, 1|2 and 2|4 are allowed, each optionally with `TLS_KEYLOG` (8, under Both sides). Any other combination, CHAIN_ONLY|INSECURE and unknown bits included, is refused.
- **A client certificate (mTLS):** `tls_client_cert` takes the caller's own chain (concatenated DER, its leaf first) and private key before the first handshake.
  - The key is PEM, with the NUL counted, or DER: PKCS#8, SEC1 or PKCS#1, optionally encrypted with a passphrase (the ciphers: Encrypted private keys, under Both sides).
  - **Key sizes** (4.2.0-7, homescoop#1376): RSA keys up to 8192 bits, and EC keys on the NIST curves. The build raises TF-PSA-Crypto's `PSA_VENDOR_RSA_MAX_KEY_BITS` from 4096 to 8192 (`rsa-max-key-bits-8192.patch`), the most its bignums hold (`MBEDTLS_MPI_MAX_SIZE`, 1024 bytes). A chain certificate with a larger RSA key is refused at `tls_client_cert` with `TLS_RSA_TOO_LARGE` (-0x10000, "tls-engine - RSA key larger than 8192 bits"). The 8192-bit limit is the whole engine's: a server certificate or a trust-store root with a larger RSA key fails to parse, with Mbed TLS's own error.
  - The key must match the leaf: a key for another certificate is refused at `tls_client_cert` (`TLS_BADARG`), before any handshake. It comes only from the caller; there's no default.
  - The engine wipes the key and passphrase bytes it was given once they're parsed, and frees (zeroizes) its copy with the session.
- **Cipher:** `tls_ciphersuite` gives the negotiated ciphersuite's IANA number.
- **Alerts:** after a handshake or read fails with Mbed TLS's FATAL_ALERT_MESSAGE, `tls_last_alert` gives the description number of the alert the server sent: 116 (certificate_required) from a TLS 1.3 server that wanted a client certificate, 40 (handshake_failure) from a TLS 1.2 one. Otherwise, and for a server session, it's -1.
- **Chain verification without a handshake** (4.2.0-5, slicc-kernel#1090): `tls_chain_verify(store, chain, len, hostname, flagsOut)` verifies a server's chain (concatenated DER, its leaf first) against a trust store with the checks a client session makes. Those are the default profile, the store's roots, validity by the real clock, the leaf's key usage and serverAuth extended key usage, and the session's own name check: an IP literal only against an iPAddress SAN, one trailing dot stripped. It returns 0 only when the chain verified (flags 0), 1 when it verified and failed (the flags say why), or < 0 with the flags set to `0xffffffff`, never 0, for a NULL store, an empty or malformed chain, an allocation failure or any other error. **A NULL `hostname` skips the name check; the caller must then establish the server's identity another way** (an SPKI pin). Nothing is kept. `tls_test_chain_verify_alloc_error()` makes the next call fail as an allocation failure.
- **Not exposed (known):** the negotiated key-exchange group and signature algorithm. Mbed TLS 4.2.0 has no public getter for either, only the configured group list.
- **Server names:**
  - A DNS name is sent as SNI and checked against the leaf's DNS names, as Mbed TLS checks them (subjectAltName, else the CN).
  - An IPv4 or IPv6 literal is not sent as SNI (RFC 6066). It must match an iPAddress subjectAltName of the leaf, never a DNS name or a CN that spells it.
  - One trailing dot (an absolute name such as `example.com.`) is dropped, for SNI and the check alike.
- **Protocol:** TLS 1.2 minimum and TLS 1.3 maximum. No renegotiation, and no session tickets or resumption: every connection is a full handshake and a full verification.
- **Handshake:** `tls_handshake` drives it. It returns 1 when the handshake is done, 0 when it needs more ciphertext, and otherwise an error. A refused chain is `MBEDTLS_ERR_X509_CERT_VERIFY_FAILED`.
  - `tls_verify_result` gives Mbed TLS's `MBEDTLS_X509_BADCERT_*` flags (0 = verified, -1 = no certificate yet), and `tls_verify_info` puts them in words.
  - `tls_alpn` gives the agreed protocol, and `tls_version` the version.
  - `tls_peer_count` and `tls_peer_der` give the server's chain as sent, its leaf first.
  - After the handshake, the I/O is the server sessions'.
  - `tls_read` returns 0 only when nothing buffered can still be processed. TLS 1.3 NewSessionTickets ahead of the data are consumed within the same call (homescoop#1032).

### Limits

- **No revocation checking:** neither OCSP nor CRLs, as with Node's default.
- **No session resumption.**
- **The clock is the caller's `Date.now()`,** through Emscripten's `time()`. A page with a wrong clock refuses valid certificates, or accepts expired ones.

## `roots.der`

The default trust store a caller may load is `dist/roots.der`, also exported as `@ai-ecoverse/wasm-tls-engine/roots.der`.
- It's Mozilla's root store from curl's **cacert-2026-09-25.pem**, sha256-pinned in the recipe, as concatenated DER in the bundle's order.
- `package.json` records its date, source and hash under `slicc.tls.roots`, so a consumer can tell how old it is.
- It is MPL-2.0 data. `THIRD-PARTY-NOTICES.md` names it with that licence's text.

## Both sides

- **I/O is pull-shaped:**
  - `tls_feed` takes ciphertext in;
  - `tls_read` gives plaintext out (0 = needs more);
  - `tls_write` takes plaintext in;
  - drain the ciphertext with `tls_out_take`.
- **Entropy:** `crypto.getRandomValues` is the source of PSA's random generator (TF-PSA-Crypto), which makes every key and handshake. Without it, a call fails (`PSA - Insufficient entropy`) and never throws.
- `tls_strerror` names the engine's own codes (`TLS_EOF`, `TLS_NOMEM`, `TLS_BADARG`, `TLS_SELECT_PENDING`, `TLS_RSA_TOO_LARGE`, as "tls-engine - …") and TLS, X.509, PK, ASN.1 and PSA errors.
- **Pages and workers only** (`-sENVIRONMENT=web,worker`): there's no Node branch, whose `import('module')` would land in a bundler's eager graph. In Node, pass the module's bytes: `createTlsEngine({ wasmBinary })`.

### Encrypted private keys (Camellia and ARIA since 4.2.0-12, homescoop#1811)

`tls_client_cert` and `tls_leaf_import` parse a key the same way, so this holds for both.
- **PKCS#8 `ENCRYPTED PRIVATE KEY`** (PEM, or DER with a passphrase) with PBES2 and PBKDF2, the scheme `openssl pkcs8 -topk8 -v2 <cipher>` and Node's `KeyObject.export({ type: 'pkcs8', cipher })` write. The encryption scheme can be AES-128/192/256-CBC, Camellia-128/192/256-CBC (`-v2 camellia128|camellia192|camellia256`, RFC 3657 OIDs 1.2.392.200011.61.1.1.1.2/.3/.4) or ARIA-128/192/256-CBC (`-v2 aria-128-cbc|aria-192-cbc|aria-256-cbc`, RFC 5794 OIDs 1.2.410.200046.1.1.2/.7/.12).
- **Why a patch:** TF-PSA-Crypto 4.2.0 builds Camellia and ARIA (`PSA_WANT_KEY_TYPE_CAMELLIA`/`ARIA` are on by default) and has their CBC ciphers, but PBES2's table of encryption schemes (`oid_cipher_alg` in `tf-psa-crypto/utilities/oid.c`) lists only the three AES-CBC OIDs, so `pkcs5.c` refused any other scheme with `MBEDTLS_ERR_PKCS5_FEATURE_UNAVAILABLE`. `pbes2-camellia-aria.patch` adds the six OIDs (in `utilities/crypto_oid.h`) and maps each to its `MBEDTLS_CIPHER_*_CBC` type. The decryption is PBES2's own path, unchanged: the key length and the 16-byte IV come from the cipher, and CBC with PKCS#7 padding decrypts. The crypto configuration and the TLS ciphersuites, groups and signature algorithms the engine offers and accepts are unchanged (the cert pins them to 4.2.0-11's).
- **A wrong passphrase** is `MBEDTLS_ERR_PK_PASSWORD_MISMATCH` (-0x3B80, "PK - Given private key password does not allow for correct decryption") for AES, Camellia and ARIA alike; slicc-kernel maps it to Node's `ERR_OSSL_BAD_DECRYPT`. No passphrase for an encrypted key is `MBEDTLS_ERR_PK_PASSWORD_REQUIRED` (-0x3C00).
- **About 1 wrong passphrase in 256** decrypts to garbage whose last bytes happen to be valid PKCS#7 padding. Then the garbage is parsed as a key, and the error is that parse's: an ASN.1 or PK format error (`MBEDTLS_ERR_ASN1_UNEXPECTED_TAG`, -0x62, for the cert's fixed cases), not PASSWORD_MISMATCH. OpenSSL does the same: Node then throws a decoder or ASN.1 error, not `ERR_OSSL_BAD_DECRYPT`. Which one depends on the OpenSSL version: `ERR_OSSL_UNSUPPORTED` ("DECODER routines::unsupported") with Node 26's bundled OpenSSL 3.5, `ERR_OSSL_ASN1_WRONG_TAG` or `ERR_OSSL_ASN1_HEADER_TOO_LONG` with OpenSSL 4.0. The cert uses fixed keys and passphrases, so which case a row hits never changes.
- **Differences from Node:**
  - **3DES is refused.** Mbed TLS dropped DES when its crypto moved to TF-PSA-Crypto, which has no DES cipher, and the engine doesn't add it back. A PKCS#8 key written with `-v2 des3` (des-ede3-cbc) is refused with `MBEDTLS_ERR_PKCS5_FEATURE_UNAVAILABLE` (-0x2E80, "PKCS5 - Requested encryption or digest alg not available") whether the passphrase is right or wrong: the scheme is looked up before anything is decrypted. Node takes it. Re-encrypt such a key with `openssl pkcs8 -topk8 -v2 aes-256-cbc`.
  - **Traditional encrypted PEM** (`Proc-Type: 4,ENCRYPTED` with `DEK-Info`, as `openssl ec -aes256` writes) works with AES-CBC only, Mbed TLS's PEM decryption; a `DEK-Info: CAMELLIA-256-CBC` key is refused with `MBEDTLS_ERR_PEM_UNKNOWN_ENC_ALG` (-0x1280, which `tls_strerror` doesn't name). Node takes it.
  - PBES1 and PKCS#12 schemes (`openssl pkcs8 -v1 …`) aren't supported, as before.

### Key log lines (4.2.0-10, homescoop#1774; EXPORTER_SECRET since 4.2.0-11, homescoop#1799)

For Node's `keylog` event and `SSLKEYLOGFILE` (slicc-kernel#1504). **Off by default; the lines are the session's secrets: anyone holding them can decrypt the session.**
- **Opt in per session** with `TLS_KEYLOG` (8) in the flags of `tls_client_new`, `tls_client_new_name` or `tls_server_new`. It combines with every flag combination those calls accept; one they refuse stays refused. `tls_session_new` has no flags and never logs.
- **`tls_keylog(session, out, max)`** drains the lines collected so far into `out`: their length in bytes, 0 when there are none, or `TLS_BADARG` (nothing drained) when `max` can't hold the first whole line. It hands out whole lines only, as many as fit, and keeps the rest for the next call; `max` of 4096 or more always takes everything. Lines appear as the handshake derives the secrets, so drain after `tls_handshake`/`tls_read` and emit one `keylog` event per line.
- **The lines** are the NSS key log format, lowercase hex, each ending in `\n`, the client random as the second field:
  - TLS 1.2: `CLIENT_RANDOM <client random> <master secret>`;
  - TLS 1.3, five lines: `CLIENT_HANDSHAKE_TRAFFIC_SECRET`, `SERVER_HANDSHAKE_TRAFFIC_SECRET`, `CLIENT_TRAFFIC_SECRET_0` and `SERVER_TRAFFIC_SECRET_0`, from Mbed TLS's `mbedtls_ssl_set_export_keys_cb`, and `EXPORTER_SECRET <client random> <exporter master secret>` (RFC 8446 §7.5), on client and server sessions alike.
  - They're the lines OpenSSL writes for the same session (`openssl s_client -keylogfile`, Node's `keylog`), all five on TLS 1.3. There are no early-data lines: no session resumes.
  - **Where `EXPORTER_SECRET` comes from:** Mbed TLS 4.2.0's export callback has no type for the exporter master secret. Its key schedule derives it with the application traffic secrets, in one step (`mbedtls_ssl_tls13_derive_application_secrets`, called from `ssl_tls13_generate_application_keys` in `library/ssl_tls13_keys.c`), into `session_negotiate->app_secrets.exporter_master_secret`, and only then exports the client's and then the server's application traffic secret. Client and server reach that step through the same `mbedtls_ssl_tls13_compute_application_transform` (after the server's Finished is read, or written). So when the callback reports `SERVER_APPLICATION_TRAFFIC_SECRET`, the engine reads the exporter master secret from the session in negotiation, with that call's secret length (the suite's hash length), and logs it right after `SERVER_TRAFFIC_SECRET_0`. Mbed TLS's sources aren't patched for it. TLS 1.2 has no exporter master secret, and its one `CLIENT_RANDOM` line is unchanged.
- **Without the flag nothing is collected or kept:** no export callback is registered, and the session's key log buffer stays zero.
- **Wiping:** the buffer lives inside the session. `tls_keylog` zeroes the bytes it hands out (what's left moves up and the tail is zeroed), and `tls_session_free` zeroes the whole buffer. Wiping the caller's `out` is the caller's job.
- **Bound and overflow:** the buffer holds 4096 bytes. One session has one handshake (no renegotiation, no resumption), and its lines take at most 938 bytes (the five TLS 1.3 lines with SHA-384 secrets: each is its label, a space, 64 hex digits of client random, a space, 96 hex digits of secret and `\n`, so 163 bytes plus labels of 31, 31, 23, 23 and 15; TLS 1.2's one line is 176), so it can't fill even if never drained. Should a line ever not fit, it's dropped whole: never truncated, and never overwriting earlier lines, so the buffer only ever holds complete lines.
- **Test hooks:** `tls_test_keylog_armed(session)` is 1 when the export callback is registered; `tls_test_keylog_residue(session)` counts the buffer's non-zero bytes plus its pending length (0 means empty and wiped); `tls_test_keylog_cap(session, cap)` lowers the bound of a `TLS_KEYLOG` session before its handshake (never above 4096; `TLS_BADARG` otherwise), so the cert can show the overflow rule. None of them reads or changes a secret.

Types: `index.d.ts`. Build: `packages/tls-engine/build.sh` in homescoop.
