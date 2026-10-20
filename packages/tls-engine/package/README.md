# @ai-ecoverse/wasm-tls-engine

TLS for [SLICC](https://github.com/ai-ecoverse/slicc): Mbed TLS 4.2.0 sessions over memory buffers, compiled with Emscripten to an ES module factory plus `slicc-tls-engine.wasm`.
- **Server sessions** serve SLICC's wasm-realm HTTP proxy (ai-ecoverse/slicc#3571).
- **Client sessions** verify a server, for slicc-kernel's raw TLS (ai-ecoverse/slicc-kernel#922).
- Both are in one wasm, loaded lazily by its callers.

## Server sessions

- The engine holds **no CA key**. `tls_leaf_new` generates a P-256 key pair, and `tls_leaf_spki` hands out only its public key. The caller builds and signs the leaf certificate and gives the chain back with `tls_leaf_add_cert`.
- There's one session per CONNECT tunnel (`tls_session_new(leaf, host)`), and a client's SNI must name `host`. ALPN offers `http/1.1` only. TLS 1.2 and 1.3.

## Client sessions

- **The trust store is the caller's.** `tls_ca_new` makes an empty store. `tls_ca_add_der` adds one DER root, and `tls_ca_add_bundle` adds concatenated DER, such as the package's `roots.der`, returning how many roots it added. On an error (< 0) it may have added the roots before the bad one, so discard that store. The engine never loads roots by itself.
- **Starting a session:** `tls_client_new(ca, servername, alpn, alpn_len, flags)` starts one. It takes the server name as a C string, an ALPN list in wire format (length-prefixed names; `0, 0` for none) and flags. `tls_client_new_name(ca, servername, servername_len, alpn, alpn_len, flags)` (since 4.2.0-6) is the same with the name's length given: a NUL byte inside the name is refused (`TLS_BADARG`), where the C-string form would end the name at it. Use it for names that come from JS.
  - **Verification is required.** The chain must reach a root in `ca`, the leaf must name the server, every certificate must be within its validity period by the clock, and the leaf must allow server use (extendedKeyUsage serverAuth and keyUsage).
  - Without a store, or with an empty server name, there's no session (`TLS_BADARG`).
  - **Flags:**
    - `TLS_CLIENT_INSECURE_SKIP_VERIFY` (1) lets the handshake finish whatever the chain says. `tls_verify_result` still reports what verification found.
    - `TLS_CLIENT_NO_SNI` (2) sends no SNI. The name is still checked exactly as with SNI: by Mbed TLS's own check, after the trailing-dot strip, and an IP literal only against an iPAddress SAN.
    - **`TLS_CLIENT_VERIFY_CHAIN_ONLY` (4) skips the hostname check. The caller MUST check the server's identity itself**, for example with Node's `checkServerIdentity` on `tls_peer_der(s, 0)`. Chain, validity and key usage are still required, and SNI is still sent. `tls_name_mismatch` gives the skipped check's result, so a mismatch is reported, not silent.
    - Only 0, 1, 2, 4, 1|2 and 2|4 are allowed. Any other combination, CHAIN_ONLY|INSECURE and unknown bits included, is refused.
- **A client certificate (mTLS):** `tls_client_cert` takes the caller's own chain (concatenated DER, its leaf first) and private key before the first handshake.
  - The key is PEM, with the NUL counted, or DER: PKCS#8, SEC1 or PKCS#1, optionally encrypted with a passphrase.
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
- `tls_strerror` names the engine's own codes (`TLS_EOF`, `TLS_NOMEM`, `TLS_BADARG`, as "tls-engine - …") and TLS, X.509, PK, ASN.1 and PSA errors.
- **Pages and workers only** (`-sENVIRONMENT=web,worker`): there's no Node branch, whose `import('module')` would land in a bundler's eager graph. In Node, pass the module's bytes: `createTlsEngine({ wasmBinary })`.

Types: `index.d.ts`. Build: `packages/tls-engine/build.sh` in homescoop.
