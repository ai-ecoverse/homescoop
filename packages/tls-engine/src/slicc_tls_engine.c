/*
 * slicc_tls_engine.c — the server side of TLS for SLICC's wasm-realm HTTP
 * proxy (#3571): Mbed TLS over memory buffers, one session per CONNECT
 * tunnel, the certificate chain supplied from outside.
 *
 * The engine never holds a CA key. A leaf's key pair is generated here and
 * only its public key leaves (tls_leaf_spki); the caller builds and signs the
 * leaf certificate (with a CA key the engine never sees) and hands back the
 * DER chain (tls_leaf_add_cert: the leaf, then its issuer). A session then
 * serves that chain to a client whose SNI (if any) names the session's host.
 *
 * I/O is pull-shaped: the caller feeds ciphertext it read from the client
 * (tls_feed), asks for plaintext (tls_read: > 0 bytes, 0 = needs more
 * ciphertext, TLS_EOF = the client closed), writes plaintext (tls_write), and
 * after every call drains the ciphertext to send (tls_out_size / tls_out_take).
 * The handshake runs inside tls_read / tls_write as needed.
 *
 * Entropy comes from crypto.getRandomValues (MBEDTLS_ENTROPY_HARDWARE_ALT).
 */
#include <ctype.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>
#include "mbedtls/ctr_drbg.h"
#include "mbedtls/ecp.h"
#include "mbedtls/entropy.h"
#include "mbedtls/error.h"
#include "mbedtls/pk.h"
#include "mbedtls/ssl.h"
#include "mbedtls/x509_crt.h"
#include "psa/crypto.h"

#define IN_CAP (40 * 1024)
#define OUT_CAP (64 * 1024)
#define TLS_EOF (-1)
#define TLS_NOMEM (-2)
#define TLS_BADARG (-3)

static const char *alpn_protocols[] = {"http/1.1", NULL};
static int last_error;
static int ready;
static mbedtls_entropy_context entropy;
static mbedtls_ctr_drbg_context drbg;

EM_JS(int, slicc_random, (unsigned char *out, size_t len), {
  for (let at = 0; at < len; at += 65536) {
    const n = Math.min(65536, len - at);
    globalThis.crypto.getRandomValues(HEAPU8.subarray(out + at, out + at + n));
  }
  return 0;
});

int mbedtls_hardware_poll(void *data, unsigned char *out, size_t len, size_t *olen) {
  (void)data;
  int ret = slicc_random(out, len);
  *olen = ret == 0 ? len : 0;
  return ret;
}

static int init(void) {
  if (ready) return 0;
  int ret = psa_crypto_init();
  if (ret != PSA_SUCCESS) return last_error = ret;
  mbedtls_entropy_init(&entropy);
  mbedtls_ctr_drbg_init(&drbg);
  ret = mbedtls_ctr_drbg_seed(&drbg, mbedtls_entropy_func, &entropy,
                              (const unsigned char *)"slicc-tls", 9);
  if (ret != 0) return last_error = ret;
  ready = 1;
  return 0;
}

/* ---- leaves: a key pair and the chain the caller signed for it ---------- */

typedef struct {
  mbedtls_pk_context key;
  mbedtls_x509_crt chain;
  int certs;
  int refs;
} leaf;

static void leaf_release(leaf *l) {
  if (--l->refs > 0) return;
  mbedtls_pk_free(&l->key);
  mbedtls_x509_crt_free(&l->chain);
  free(l);
}

EMSCRIPTEN_KEEPALIVE int tls_last_error(void) { return last_error; }

EMSCRIPTEN_KEEPALIVE void tls_strerror(int code, char *out, size_t max) {
  mbedtls_strerror(code, out, max);
}

/* A new P-256 key pair; 0 on failure (tls_last_error). */
EMSCRIPTEN_KEEPALIVE leaf *tls_leaf_new(void) {
  if (init() != 0) return NULL;
  leaf *l = calloc(1, sizeof *l);
  if (!l) return NULL;
  l->refs = 1;
  mbedtls_pk_init(&l->key);
  mbedtls_x509_crt_init(&l->chain);
  int ret = mbedtls_pk_setup(&l->key, mbedtls_pk_info_from_type(MBEDTLS_PK_ECKEY));
  if (ret == 0)
    ret = mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1, mbedtls_pk_ec(l->key),
                              mbedtls_ctr_drbg_random, &drbg);
  if (ret != 0) {
    last_error = ret;
    leaf_release(l);
    return NULL;
  }
  return l;
}

/* The public key as DER SubjectPublicKeyInfo at the start of `out`; its length, or < 0. */
EMSCRIPTEN_KEEPALIVE int tls_leaf_spki(leaf *l, unsigned char *out, size_t max) {
  int n = mbedtls_pk_write_pubkey_der(&l->key, out, max);
  if (n < 0) return last_error = n;
  memmove(out, out + max - n, n);
  return n;
}

/* Append a DER certificate to the chain: the leaf first (it must match the key), then its issuers. */
EMSCRIPTEN_KEEPALIVE int tls_leaf_add_cert(leaf *l, const unsigned char *der, size_t len) {
  int ret = mbedtls_x509_crt_parse_der(&l->chain, der, len);
  if (ret != 0) return last_error = ret;
  if (l->certs == 0) {
    ret = mbedtls_pk_check_pair(&l->chain.pk, &l->key, mbedtls_ctr_drbg_random, &drbg);
    if (ret != 0) return last_error = ret;
  }
  l->certs++;
  return 0;
}

EMSCRIPTEN_KEEPALIVE void tls_leaf_free(leaf *l) { leaf_release(l); }

/* ---- sessions ------------------------------------------------------------ */

typedef struct {
  mbedtls_ssl_context ssl;
  mbedtls_ssl_config config;
  leaf *leaf;
  char host[256];
  unsigned char in[IN_CAP], out[OUT_CAP];
  size_t in_len, out_len;
  int in_eof;
} session;

static int bio_recv(void *ctx, unsigned char *buf, size_t len) {
  session *s = ctx;
  if (s->in_len == 0) return s->in_eof ? MBEDTLS_ERR_SSL_CONN_EOF : MBEDTLS_ERR_SSL_WANT_READ;
  size_t n = len < s->in_len ? len : s->in_len;
  memcpy(buf, s->in, n);
  memmove(s->in, s->in + n, s->in_len - n);
  s->in_len -= n;
  return (int)n;
}

static int bio_send(void *ctx, const unsigned char *buf, size_t len) {
  session *s = ctx;
  size_t room = OUT_CAP - s->out_len;
  if (room == 0) return MBEDTLS_ERR_SSL_WANT_WRITE;
  size_t n = len < room ? len : room;
  memcpy(s->out + s->out_len, buf, n);
  s->out_len += n;
  return (int)n;
}

/* The client's SNI, when it sends one, must name the host of the tunnel. */
static int on_sni(void *ctx, mbedtls_ssl_context *ssl, const unsigned char *name, size_t len) {
  (void)ssl;
  session *s = ctx;
  if (strlen(s->host) != len) return -1;
  for (size_t i = 0; i < len; i++)
    if (tolower(name[i]) != tolower((unsigned char)s->host[i])) return -1;
  return 0;
}

static void session_free(session *s) {
  mbedtls_ssl_free(&s->ssl);
  mbedtls_ssl_config_free(&s->config);
  if (s->leaf) leaf_release(s->leaf);
  free(s);
}

/* A server session for `host` presenting `l`'s chain; 0 on failure. */
EMSCRIPTEN_KEEPALIVE session *tls_session_new(leaf *l, const char *host) {
  if (init() != 0) return NULL;
  if (!l || l->certs == 0 || !host || strlen(host) >= sizeof(((session *)0)->host)) {
    last_error = TLS_BADARG;
    return NULL;
  }
  session *s = calloc(1, sizeof *s);
  if (!s) {
    last_error = TLS_NOMEM;
    return NULL;
  }
  strcpy(s->host, host);
  mbedtls_ssl_init(&s->ssl);
  mbedtls_ssl_config_init(&s->config);
  s->leaf = l;
  l->refs++;
  int ret = mbedtls_ssl_config_defaults(&s->config, MBEDTLS_SSL_IS_SERVER,
                                        MBEDTLS_SSL_TRANSPORT_STREAM, MBEDTLS_SSL_PRESET_DEFAULT);
  if (ret == 0) {
    mbedtls_ssl_conf_rng(&s->config, mbedtls_ctr_drbg_random, &drbg);
    mbedtls_ssl_conf_sni(&s->config, on_sni, s);
    ret = mbedtls_ssl_conf_own_cert(&s->config, &l->chain, &l->key);
  }
  if (ret == 0) ret = mbedtls_ssl_conf_alpn_protocols(&s->config, alpn_protocols);
  if (ret == 0) ret = mbedtls_ssl_setup(&s->ssl, &s->config);
  if (ret != 0) {
    last_error = ret;
    session_free(s);
    return NULL;
  }
  mbedtls_ssl_set_bio(&s->ssl, s, bio_send, bio_recv, NULL);
  return s;
}

/* Take up to `len` bytes of ciphertext from the client; how many were taken. */
EMSCRIPTEN_KEEPALIVE int tls_feed(session *s, const unsigned char *bytes, size_t len) {
  size_t room = IN_CAP - s->in_len;
  size_t n = len < room ? len : room;
  memcpy(s->in + s->in_len, bytes, n);
  s->in_len += n;
  return (int)n;
}

/* The client closed its side: no more ciphertext will come. */
EMSCRIPTEN_KEEPALIVE void tls_feed_eof(session *s) { s->in_eof = 1; }

/* Room left for tls_feed. */
EMSCRIPTEN_KEEPALIVE int tls_in_room(session *s) { return (int)(IN_CAP - s->in_len); }

static int want(int ret) {
  return ret == MBEDTLS_ERR_SSL_WANT_READ || ret == MBEDTLS_ERR_SSL_WANT_WRITE ||
         ret == MBEDTLS_ERR_SSL_RECEIVED_NEW_SESSION_TICKET ||
         ret == MBEDTLS_ERR_SSL_ASYNC_IN_PROGRESS;
}

/* Plaintext from the client: > 0 bytes, 0 when more ciphertext is needed, TLS_EOF, or an error. */
EMSCRIPTEN_KEEPALIVE int tls_read(session *s, unsigned char *out, size_t max) {
  for (;;) {
    int ret;
    if (!mbedtls_ssl_is_handshake_over(&s->ssl)) {
      ret = mbedtls_ssl_handshake(&s->ssl);
      if (ret == 0) continue; /* done: on to the first read */
    } else {
      ret = mbedtls_ssl_read(&s->ssl, out, max);
      if (ret > 0) return ret;
      if (ret == 0) return TLS_EOF;
    }
    if (ret == MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY || ret == MBEDTLS_ERR_SSL_CONN_EOF) return TLS_EOF;
    if (ret == MBEDTLS_ERR_SSL_RECEIVED_NEW_SESSION_TICKET) continue;
    if (want(ret)) return 0;
    return last_error = ret;
  }
}

/* Encrypt up to `len` bytes of plaintext: how many were taken (0: drain tls_out and retry), or an error. */
EMSCRIPTEN_KEEPALIVE int tls_write(session *s, const unsigned char *bytes, size_t len) {
  int ret = mbedtls_ssl_write(&s->ssl, bytes, len);
  if (ret >= 0) return ret;
  if (want(ret)) return 0;
  return last_error = ret;
}

/* Whether the handshake is done (a write before it would drive it, which the proxy never needs). */
EMSCRIPTEN_KEEPALIVE int tls_handshake_done(session *s) {
  return mbedtls_ssl_is_handshake_over(&s->ssl);
}

EMSCRIPTEN_KEEPALIVE int tls_out_size(session *s) { return (int)s->out_len; }

/* Take up to `max` bytes of ciphertext to send to the client. */
EMSCRIPTEN_KEEPALIVE int tls_out_take(session *s, unsigned char *out, size_t max) {
  size_t n = max < s->out_len ? max : s->out_len;
  memcpy(out, s->out, n);
  memmove(s->out, s->out + n, s->out_len - n);
  s->out_len -= n;
  return (int)n;
}

/* Queue close_notify (then drain tls_out). */
EMSCRIPTEN_KEEPALIVE int tls_close(session *s) {
  int ret = mbedtls_ssl_close_notify(&s->ssl);
  return want(ret) ? 0 : ret;
}

/* 0x0303 (TLS 1.2) or 0x0304 (TLS 1.3) once negotiated. */
EMSCRIPTEN_KEEPALIVE int tls_version(session *s) {
  return (int)mbedtls_ssl_get_version_number(&s->ssl);
}

/* 1 when the client agreed on http/1.1 by ALPN. */
EMSCRIPTEN_KEEPALIVE int tls_alpn_http11(session *s) {
  return mbedtls_ssl_get_alpn_protocol(&s->ssl) != NULL;
}

EMSCRIPTEN_KEEPALIVE void tls_session_free(session *s) { session_free(s); }
