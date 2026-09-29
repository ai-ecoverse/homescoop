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
}

export interface TlsEngineOptions {
  /** The module's bytes, when the caller loads them itself. */
  wasmBinary?: ArrayBuffer | Uint8Array;
  /** Where the glue finds `slicc-tls-engine.wasm` (default: beside the glue). */
  locateFile?: (path: string, prefix: string) => string;
}

export default function createTlsEngine(options?: TlsEngineOptions): Promise<TlsEngineModule>;
