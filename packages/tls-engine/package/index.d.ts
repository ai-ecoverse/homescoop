/**
 * The raw Emscripten module of the SLICC TLS engine. Pointers are numbers
 * into HEAPU8; see src/slicc_tls_engine.c for each call's contract.
 */
export interface TlsEngineModule {
  readonly HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _tls_last_error(): number;
  _tls_strerror(code: number, out: number, max: number): void;
  /** A new P-256 key pair (a leaf); 0 on failure. */
  _tls_leaf_new(): number;
  /** The leaf's public key as DER SubjectPublicKeyInfo; its length, or < 0. */
  _tls_leaf_spki(leaf: number, out: number, max: number): number;
  /** Append a DER certificate: the leaf's own first, then its issuers. 0 or < 0. */
  _tls_leaf_add_cert(leaf: number, der: number, len: number): number;
  _tls_leaf_free(leaf: number): void;
  /** A server session for `host` (a C string) presenting the leaf's chain; 0 on failure. */
  _tls_session_new(leaf: number, host: number): number;
  _tls_leaf_import(chain: number, chainLen: number, key: number, keyLen: number, pass: number, passLen: number): number;
  _tls_server_new(leaf: number, alpn: number, alpnLen: number, clientCa: number, flags: number): number;
  _tls_sni(session: number, out: number, max: number): number;
  _tls_server_select(session: number, leaf: number, alpn: number, alpnLen: number): number;
  _tls_server_refuse(session: number, alert: number): number;
  _tls_client_alpn(session: number, out: number, max: number): number;
  _tls_keylog(session: number, out: number, max: number): number;
  _tls_test_keylog_armed(session: number): number;
  _tls_test_keylog_residue(session: number): number;
  _tls_test_keylog_cap(session: number, cap: number): number;
  /** Ciphertext from the client: how many bytes were taken. */
  _tls_feed(session: number, bytes: number, len: number): number;
  _tls_feed_eof(session: number): void;
  _tls_in_room(session: number): number;
  /** Plaintext: > 0 bytes, 0 = needs more ciphertext, -1 = the client closed, else an Mbed TLS error. */
  _tls_read(session: number, out: number, max: number): number;
  /** Plaintext to encrypt: bytes taken, 0 = drain the output and retry, < 0 an error. */
  _tls_write(session: number, bytes: number, len: number): number;
  _tls_handshake_done(session: number): number;
  _tls_out_size(session: number): number;
  _tls_out_take(session: number, out: number, max: number): number;
  _tls_close(session: number): number;
  _tls_version(session: number): number;
  _tls_alpn_http11(session: number): number;
  _tls_session_free(session: number): void;
  /** An empty trust store; 0 on failure. */
  _tls_ca_new(): number;
  /** Add one DER root: 0 or < 0. */
  _tls_ca_add_der(ca: number, der: number, len: number): number;
  /** Add concatenated DER roots (roots.der): how many were added, or < 0. */
  _tls_ca_add_bundle(ca: number, bytes: number, len: number): number;
  _tls_ca_count(ca: number): number;
  _tls_ca_free(ca: number): void;
  /**
   * A client session to `servername` (a C string) verifying against `ca`; 0 on failure.
   * `alpn`/`alpnLen`: an ALPN list in wire format (0, 0 for none). `flags`: 0, or
   * 1 (TLS_CLIENT_INSECURE_SKIP_VERIFY) to finish the handshake whatever verification finds,
   * 2 (TLS_CLIENT_NO_SNI) to send no SNI (the name is still checked, exactly as with SNI), 4
   * (TLS_CLIENT_VERIFY_CHAIN_ONLY): SKIPS THE HOSTNAME CHECK; the caller MUST check the
   * server's identity itself (e.g. Node's checkServerIdentity), and tls_name_mismatch says
   * what the skipped check found. Every other combination than 0, 1, 2, 4, 1|2 and 2|4 is refused.
   */
  _tls_client_new(ca: number, servername: number, alpn: number, alpnLen: number, flags: number): number;
  /**
   * The same with the server name as `servernameLen` bytes at `servername` (UTF-8, no NUL
   * needed): a NUL byte inside the name is refused with TLS_BADARG, never cut at
   * (homescoop#1042, 4.2.0-6). Prefer it over _tls_client_new for names that come from JS.
   */
  _tls_client_new_name(ca: number, servername: number, servernameLen: number, alpn: number, alpnLen: number, flags: number): number;
  /** 1 when the handshake is done, 0 when it needs more ciphertext, < 0 an error. */
  _tls_handshake(session: number): number;
  /** MBEDTLS_X509_BADCERT_* flags: 0 verified, -1 no certificate yet. */
  _tls_verify_result(session: number): number;
  /** The flags in words at `out`; its length, or < 0. */
  _tls_verify_info(flags: number, out: number, max: number): number;
  /** The protocol ALPN agreed on at `out`: its length, 0 for none. */
  _tls_alpn(session: number, out: number, max: number): number;
  /** How many certificates the server sent. */
  _tls_peer_count(session: number): number;
  /** The server's certificate at `index` (0 = its leaf) as DER at `out`: its length, or < 0. */
  _tls_peer_der(session: number, index: number, out: number, max: number): number;
  /**
   * The client's own chain (concatenated DER, leaf first) and private key (PEM, NUL
   * included in `keyLen`, or DER; `pass` decrypts an encrypted key, 0, 0 for none),
   * before the first handshake call: 0 or < 0 (TLS_BADARG for a key that doesn't match the
   * leaf, a second call or a call after the handshake started). The key and passphrase bytes are wiped.
   */
  _tls_client_cert(session: number, chain: number, chainLen: number, key: number, keyLen: number, pass: number, passLen: number): number;
  /** 1 when the leaf did not name the server: under TLS_CLIENT_VERIFY_CHAIN_ONLY, the skipped check's result. */
  _tls_name_mismatch(session: number): number;
  /** Test hook: the TLS_CLIENT_NO_SNI name check fails as an allocation failure would, so every leaf is refused (only ever stricter). */
  _tls_test_name_check_error(session: number): number;
  /** The negotiated ciphersuite's IANA number, 0 before the handshake. */
  _tls_ciphersuite(session: number): number;
  /** The description number of the fatal alert the server sent (e.g. 116 certificate_required, 40 handshake_failure), -1 for none and for a server session. */
  _tls_last_alert(session: number): number;
  /**
   * Verify `chain` (concatenated DER, leaf first) against `store` outside any handshake, with a
   * client session's checks: the default profile, the store's roots, validity by the real clock,
   * the leaf's key usage (digitalSignature) and extended key usage (serverAuth when listed), and
   * the session's name check of `hostname` (NUL-terminated; an IP literal only against an
   * iPAddress SAN, one trailing dot stripped). 0 only when verified (`flagsOut`, a uint32, is 0);
   * 1 when it verified and failed, with the Mbed TLS verify flags at `flagsOut`; or < 0 with
   * `flagsOut` set to 0xffffffff (never 0) for a NULL
   * store, an empty or malformed chain, an allocation failure or any other error.
   * `hostname` 0 (NULL) skips the name check: the caller must then establish the server's
   * identity another way, such as an SPKI pin. Nothing is kept.
   */
  _tls_chain_verify(store: number, chain: number, chainLen: number, hostname: number, flagsOut: number): number;
  /** Test hook: the next `_tls_chain_verify` fails as an allocation failure (only ever stricter). */
  _tls_test_chain_verify_alloc_error(): void;
}

export interface TlsEngineOptions {
  /** The module's bytes, when the caller loads them itself. */
  wasmBinary?: ArrayBuffer | Uint8Array;
  /** Where the glue finds `slicc-tls-engine.wasm` (default: beside the glue). */
  locateFile?: (path: string, prefix: string) => string;
}

export default function createTlsEngine(options?: TlsEngineOptions): Promise<TlsEngineModule>;
