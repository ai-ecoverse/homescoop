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
   * 1 (TLS_CLIENT_INSECURE_SKIP_VERIFY) to finish the handshake whatever verification finds.
   */
  _tls_client_new(ca: number, servername: number, alpn: number, alpnLen: number, flags: number): number;
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
}

export interface TlsEngineOptions {
  /** The module's bytes, when the caller loads them itself. */
  wasmBinary?: ArrayBuffer | Uint8Array;
  /** Where the glue finds `slicc-tls-engine.wasm` (default: beside the glue). */
  locateFile?: (path: string, prefix: string) => string;
}

export default function createTlsEngine(options?: TlsEngineOptions): Promise<TlsEngineModule>;
