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
 * Entropy comes from crypto.getRandomValues: tls_engine_crypto_config.h swaps
 * the built-in OS sources for this file's mbedtls_platform_get_entropy
 * (MBEDTLS_PSA_DRIVER_GET_ENTROPY), which seeds PSA's DRBG. Since Mbed TLS 4
 * (TF-PSA-Crypto) every random draw, the leaves' keys and the handshakes
 * included, comes from that one generator; there is no DRBG of our own.
 */
#include <ctype.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>
#include "mbedtls/asn1.h"
#include "mbedtls/error.h"
#include "mbedtls/pk.h"
#include "mbedtls/platform.h"
#include "mbedtls/platform_util.h"
#include "mbedtls/ssl.h"
#include "mbedtls/x509_crt.h"
#include "psa/crypto.h"

#define IN_CAP (40 * 1024)
#define OUT_CAP (64 * 1024)
#define TLS_EOF (-1)
#define TLS_NOMEM (-2)
#define TLS_BADARG (-3)
#define TLS_CLIENT_INSECURE_SKIP_VERIFY 1
#define TLS_CLIENT_NO_SNI 2
#define TLS_CLIENT_VERIFY_CHAIN_ONLY 4
#define TLS_CLIENT_FLAGS (TLS_CLIENT_INSECURE_SKIP_VERIFY | TLS_CLIENT_NO_SNI | TLS_CLIENT_VERIFY_CHAIN_ONLY)
#define ALPN_MAX 8

static const char *const alpn_protocols[] = {"http/1.1", NULL};
static int last_error;
static int ready;

/* A throw must not unwind through C: psa_crypto_init would be left half
 * done (#551). A failure is an error code, and the next call tries again. */
EM_JS(int, slicc_random, (unsigned char *out, size_t len), {
  try {
    for (let at = 0; at < len; at += 65536) {
      const n = Math.min(65536, len - at);
      globalThis.crypto.getRandomValues(HEAPU8.subarray(out + at, out + at + n));
    }
    return 0;
  } catch (err) {
    return -1;
  }
});

/* PSA's entropy source (MBEDTLS_PSA_DRIVER_GET_ENTROPY): full entropy, every byte. */
int mbedtls_platform_get_entropy(psa_driver_get_entropy_flags_t flags, size_t *estimate_bits,
                                 unsigned char *out, size_t len) {
  if (flags != 0) return PSA_ERROR_NOT_SUPPORTED;
  if (slicc_random(out, len) != 0) return PSA_ERROR_INSUFFICIENT_ENTROPY;
  *estimate_bits = 8 * len;
  return 0;
}

static int init(void) {
  if (ready) return 0;
  int ret = psa_crypto_init();
  if (ret != PSA_SUCCESS) return last_error = ret;
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

/* Mbed TLS 4's mbedtls_strerror names TLS and X.509 errors only: TF-PSA-Crypto
 * has no English text, so PSA's, PK's and ASN.1's codes come back as
 * "UNKNOWN ERROR CODE (…)". Name those a leaf can hit (PK's and ASN.1's in
 * 3.6's words). */
static const char *crypto_strerror(int code) {
  switch (code) {
    case PSA_ERROR_GENERIC_ERROR: return "PSA - Generic error";
    case PSA_ERROR_NOT_PERMITTED: return "PSA - Not permitted";
    case PSA_ERROR_NOT_SUPPORTED: return "PSA - Not supported";
    case PSA_ERROR_INVALID_ARGUMENT: return "PSA - Invalid argument";
    case PSA_ERROR_INVALID_HANDLE: return "PSA - Invalid handle";
    case PSA_ERROR_BAD_STATE: return "PSA - Bad state";
    case PSA_ERROR_BUFFER_TOO_SMALL: return "PSA - Buffer too small";
    case PSA_ERROR_ALREADY_EXISTS: return "PSA - Already exists";
    case PSA_ERROR_DOES_NOT_EXIST: return "PSA - Does not exist";
    case PSA_ERROR_INSUFFICIENT_MEMORY: return "PSA - Insufficient memory";
    case PSA_ERROR_INSUFFICIENT_STORAGE: return "PSA - Insufficient storage";
    case PSA_ERROR_INSUFFICIENT_DATA: return "PSA - Insufficient data";
    case PSA_ERROR_SERVICE_FAILURE: return "PSA - Service failure";
    case PSA_ERROR_COMMUNICATION_FAILURE: return "PSA - Communication failure";
    case PSA_ERROR_STORAGE_FAILURE: return "PSA - Storage failure";
    case PSA_ERROR_HARDWARE_FAILURE: return "PSA - Hardware failure";
    case PSA_ERROR_INSUFFICIENT_ENTROPY: return "PSA - Insufficient entropy";
    case PSA_ERROR_INVALID_SIGNATURE: return "PSA - Invalid signature";
    case PSA_ERROR_INVALID_PADDING: return "PSA - Invalid padding";
    case PSA_ERROR_CORRUPTION_DETECTED: return "PSA - Corruption detected";
    case PSA_ERROR_DATA_CORRUPT: return "PSA - Data corrupt";
    case PSA_ERROR_DATA_INVALID: return "PSA - Data invalid";
    case PSA_OPERATION_INCOMPLETE: return "PSA - Operation incomplete";
    case MBEDTLS_ERR_PK_TYPE_MISMATCH: return "PK - Type mismatch, eg attempt to encrypt with an ECDSA key";
    case MBEDTLS_ERR_PK_FILE_IO_ERROR: return "PK - Read/write of file failed";
    case MBEDTLS_ERR_PK_KEY_INVALID_VERSION: return "PK - Unsupported key version";
    case MBEDTLS_ERR_PK_KEY_INVALID_FORMAT: return "PK - Invalid key tag or value";
    case MBEDTLS_ERR_PK_UNKNOWN_PK_ALG: return "PK - Key algorithm is unsupported (only RSA and EC are supported)";
    case MBEDTLS_ERR_PK_PASSWORD_REQUIRED: return "PK - Private key password can't be empty";
    case MBEDTLS_ERR_PK_PASSWORD_MISMATCH: return "PK - Given private key password does not allow for correct decryption";
    case MBEDTLS_ERR_PK_INVALID_PUBKEY: return "PK - The pubkey tag or value is invalid (only RSA and EC are supported)";
    case MBEDTLS_ERR_PK_INVALID_ALG: return "PK - The algorithm tag or value is invalid";
    case MBEDTLS_ERR_PK_UNKNOWN_NAMED_CURVE: return "PK - Elliptic curve is unsupported (only NIST curves are supported)";
    case MBEDTLS_ERR_PK_FEATURE_UNAVAILABLE: return "PK - Unavailable feature, e.g. RSA disabled for RSA key";
    case MBEDTLS_ERR_ASN1_OUT_OF_DATA: return "ASN1 - Out of data when parsing an ASN1 data structure";
    case MBEDTLS_ERR_ASN1_UNEXPECTED_TAG: return "ASN1 - ASN1 tag was of an unexpected value";
    case MBEDTLS_ERR_ASN1_INVALID_LENGTH: return "ASN1 - Error when trying to determine the length or invalid length";
    case MBEDTLS_ERR_ASN1_LENGTH_MISMATCH: return "ASN1 - Actual length differs from expected length";
    case MBEDTLS_ERR_ASN1_INVALID_DATA: return "ASN1 - Data is invalid";
  }
  return NULL;
}

EMSCRIPTEN_KEEPALIVE void tls_strerror(int code, char *out, size_t max) {
  if (max == 0) return;
  const char *text = crypto_strerror(code);
  if (text) {
    snprintf(out, max, "%s", text);
    return;
  }
  /* An X.509 error with an ASN.1 cause (high + low level). */
  int magnitude = code < 0 ? -code : code;
  int high = magnitude & 0xFF80, low = magnitude & 0x7F;
  const char *cause = high && low ? crypto_strerror(-low) : NULL;
  mbedtls_strerror(cause ? -high : code, out, max);
  if (cause) {
    size_t n = strlen(out);
    if (n + 3 < max) snprintf(out + n, max - n, " : %s", cause);
  }
}

/* A new P-256 key pair; 0 on failure (tls_last_error). PSA generates it; the
 * leaf's PK context takes a copy (as if it had parsed the key), with PK's own
 * signing policy, and the generated key is destroyed. */
EMSCRIPTEN_KEEPALIVE leaf *tls_leaf_new(void) {
  if (init() != 0) return NULL;
  leaf *l = calloc(1, sizeof *l);
  if (!l) {
    last_error = TLS_NOMEM;
    return NULL;
  }
  l->refs = 1;
  mbedtls_pk_init(&l->key);
  mbedtls_x509_crt_init(&l->chain);
  psa_key_attributes_t attr = PSA_KEY_ATTRIBUTES_INIT;
  psa_set_key_type(&attr, PSA_KEY_TYPE_ECC_KEY_PAIR(PSA_ECC_FAMILY_SECP_R1));
  psa_set_key_bits(&attr, 256);
  psa_set_key_usage_flags(&attr, PSA_KEY_USAGE_EXPORT);
  mbedtls_svc_key_id_t generated = MBEDTLS_SVC_KEY_ID_INIT;
  int ret = psa_generate_key(&attr, &generated);
  if (ret == PSA_SUCCESS) ret = mbedtls_pk_copy_from_psa(generated, &l->key);
  psa_destroy_key(generated);
  psa_reset_key_attributes(&attr);
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
    ret = mbedtls_pk_check_pair(&l->chain.pk, &l->key);
    if (ret != 0) return last_error = ret;
  }
  l->certs++;
  return 0;
}

EMSCRIPTEN_KEEPALIVE void tls_leaf_free(leaf *l) { leaf_release(l); }

/* ---- sessions ------------------------------------------------------------ */

/* ---- trust stores: the roots a client session verifies against --------- */

typedef struct {
  mbedtls_x509_crt roots;
  int certs;
  int refs;
} ca;

static void ca_release(ca *c) {
  if (--c->refs > 0) return;
  mbedtls_x509_crt_free(&c->roots);
  free(c);
}

/* An empty trust store; 0 on failure (PSA must start: parsing keys needs it). */
EMSCRIPTEN_KEEPALIVE ca *tls_ca_new(void) {
  if (init() != 0) return NULL;
  ca *c = calloc(1, sizeof *c);
  if (!c) {
    last_error = TLS_NOMEM;
    return NULL;
  }
  c->refs = 1;
  mbedtls_x509_crt_init(&c->roots);
  return c;
}

/* Add one DER certificate as a trusted root: 0, or < 0. */
EMSCRIPTEN_KEEPALIVE int tls_ca_add_der(ca *c, const unsigned char *der, size_t len) {
  int ret = mbedtls_x509_crt_parse_der(&c->roots, der, len);
  if (ret != 0) return last_error = ret;
  c->certs++;
  return 0;
}

/* Add concatenated DER certificates (roots.der): how many were added, or < 0
 * for a malformed bundle. A certificate Mbed TLS cannot use is skipped. */
EMSCRIPTEN_KEEPALIVE int tls_ca_add_bundle(ca *c, const unsigned char *bytes, size_t len) {
  int added = 0;
  size_t at = 0;
  while (at < len) {
    unsigned char *p = (unsigned char *)bytes + at;
    unsigned char *start = p;
    size_t body;
    int ret = mbedtls_asn1_get_tag(&p, (unsigned char *)bytes + len, &body,
                                   MBEDTLS_ASN1_CONSTRUCTED | MBEDTLS_ASN1_SEQUENCE);
    if (ret != 0) return last_error = ret;
    size_t whole = (size_t)(p - start) + body;
    if (mbedtls_x509_crt_parse_der(&c->roots, start, whole) == 0) {
      c->certs++;
      added++;
    }
    at += whole;
  }
  return added;
}

EMSCRIPTEN_KEEPALIVE int tls_ca_count(ca *c) { return c->certs; }

EMSCRIPTEN_KEEPALIVE void tls_ca_free(ca *c) { ca_release(c); }

typedef struct {
  mbedtls_ssl_context ssl;
  mbedtls_ssl_config config;
  leaf *leaf;
  ca *trust;
  unsigned char ip[16];
  size_t ip_len;
  char alpn_buf[256];
  const char *alpn[ALPN_MAX + 1];
  char host[256];
  int flags;
  int started;
  int name_mismatch;
  int name_check_error;
  int own_set;
  mbedtls_x509_crt own_chain;
  mbedtls_pk_context own_key;
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
  if (s->own_set) {
    mbedtls_x509_crt_free(&s->own_chain);
    mbedtls_pk_free(&s->own_key);
  }
  if (s->leaf) leaf_release(s->leaf);
  if (s->trust) ca_release(s->trust);
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

static int want(int ret);

/* An IP-literal server name is checked against the leaf's iPAddress SANs
 * only (RFC 6125): never its CN or a dNSName spelling the address. */
static int ip_san_matches(const mbedtls_x509_crt *crt, const unsigned char *ip, size_t len) {
  for (const mbedtls_x509_sequence *cur = &crt->subject_alt_names; cur && cur->buf.p; cur = cur->next) {
    unsigned char type = (unsigned char)cur->buf.tag & MBEDTLS_ASN1_TAG_VALUE_MASK;
    if (type == MBEDTLS_X509_SAN_IP_ADDRESS && cur->buf.len == len && memcmp(cur->buf.p, ip, len) == 0)
      return 1;
  }
  return 0;
}

/* The name check when no hostname was set (TLS_CLIENT_NO_SNI): Mbed TLS's
 * own, by verifying the received chain again with the name and keeping only
 * the CN_MISMATCH bit. */
static int dns_name_mismatch(session *s, mbedtls_x509_crt *crt) {
  uint32_t found = 0;
  int ret = s->name_check_error
                ? MBEDTLS_ERR_X509_ALLOC_FAILED
                : mbedtls_x509_crt_verify(crt, s->trust ? &s->trust->roots : NULL, NULL, s->host,
                                          &found, NULL, NULL);
  /* A check that could not run (an allocation failure, a fatal X.509 error)
   * is a mismatch: fail closed. */
  if (ret != 0 && ret != MBEDTLS_ERR_X509_CERT_VERIFY_FAILED) return 1;
  return (found & MBEDTLS_X509_BADCERT_CN_MISMATCH) != 0;
}

/* Test hook: make the TLS_CLIENT_NO_SNI name check fail as an allocation
 * failure inside it would. It takes no code, so it can only make a session
 * stricter: every leaf is then refused. */
EMSCRIPTEN_KEEPALIVE int tls_test_name_check_error(session *s) {
  if (s->started) return TLS_BADARG;
  s->name_check_error = 1;
  return 0;
}

static int on_verify(void *ctx, mbedtls_x509_crt *crt, int depth, uint32_t *flags) {
  session *s = ctx;
  if (depth != 0) return 0;
  if (s->ip_len > 0 && !ip_san_matches(crt, s->ip, s->ip_len)) *flags |= MBEDTLS_X509_BADCERT_CN_MISMATCH;
  else if (s->ip_len == 0 && (s->flags & TLS_CLIENT_NO_SNI) && dns_name_mismatch(s, crt))
    *flags |= MBEDTLS_X509_BADCERT_CN_MISMATCH;
  s->name_mismatch = (*flags & MBEDTLS_X509_BADCERT_CN_MISMATCH) != 0;
  if (s->flags & TLS_CLIENT_VERIFY_CHAIN_ONLY) *flags &= ~MBEDTLS_X509_BADCERT_CN_MISMATCH;
  return 0;
}

static int parse_alpn(session *s, const unsigned char *wire, size_t len) {
  if (len == 0) return 0;
  if (len >= sizeof s->alpn_buf) return TLS_BADARG;
  size_t at = 0, out = 0;
  int n = 0;
  while (at < len) {
    size_t item = wire[at++];
    if (item == 0 || at + item > len || n == ALPN_MAX) return TLS_BADARG;
    memcpy(s->alpn_buf + out, wire + at, item);
    s->alpn_buf[out + item] = 0;
    s->alpn[n++] = s->alpn_buf + out;
    out += item + 1;
    at += item;
  }
  s->alpn[n] = NULL;
  return 1;
}

/* A client session to `servername` (a C string; one trailing dot, an absolute
 * name, is dropped for SNI and the check, homescoop#1033), verifying the server's chain
 * against `trust`; 0 on failure. `alpn` is an ALPN list in wire format (or
 * 0, 0). Verification is required unless flags has
 * TLS_CLIENT_INSECURE_SKIP_VERIFY, which still records the result
 * (tls_verify_result). TLS 1.2 or 1.3, no renegotiation, no resumption. */
EMSCRIPTEN_KEEPALIVE session *tls_client_new(ca *trust, const char *servername,
                                             const unsigned char *alpn, size_t alpn_len, int flags) {
  if (init() != 0) return NULL;
  int insecure = (flags & TLS_CLIENT_INSECURE_SKIP_VERIFY) != 0;
  int chain_only = (flags & TLS_CLIENT_VERIFY_CHAIN_ONLY) != 0;
  if ((flags & ~TLS_CLIENT_FLAGS) != 0 || (insecure && chain_only) || !servername ||
      strlen(servername) >= sizeof(((session *)0)->host) ||
      (!insecure && (!trust || servername[0] == 0))) {
    last_error = TLS_BADARG;
    return NULL;
  }
  session *s = calloc(1, sizeof *s);
  if (!s) {
    last_error = TLS_NOMEM;
    return NULL;
  }
  strcpy(s->host, servername);
  s->flags = flags;
  size_t name_len = strlen(s->host);
  if (name_len > 1 && s->host[name_len - 1] == '.') s->host[name_len - 1] = 0;
  s->ip_len = s->host[0] ? mbedtls_x509_crt_parse_cn_inet_pton(s->host, s->ip) : 0;
  mbedtls_ssl_init(&s->ssl);
  mbedtls_ssl_config_init(&s->config);
  if (trust) {
    s->trust = trust;
    trust->refs++;
  }
  int ret = parse_alpn(s, alpn, alpn_len);
  if (ret >= 0)
    ret = mbedtls_ssl_config_defaults(&s->config, MBEDTLS_SSL_IS_CLIENT,
                                      MBEDTLS_SSL_TRANSPORT_STREAM, MBEDTLS_SSL_PRESET_DEFAULT);
  if (ret == 0) {
    mbedtls_ssl_conf_authmode(&s->config, insecure ? MBEDTLS_SSL_VERIFY_OPTIONAL : MBEDTLS_SSL_VERIFY_REQUIRED);
    if (trust) mbedtls_ssl_conf_ca_chain(&s->config, &trust->roots, NULL);
    mbedtls_ssl_conf_min_tls_version(&s->config, MBEDTLS_SSL_VERSION_TLS1_2);
    mbedtls_ssl_conf_max_tls_version(&s->config, MBEDTLS_SSL_VERSION_TLS1_3);
    mbedtls_ssl_conf_renegotiation(&s->config, MBEDTLS_SSL_RENEGOTIATION_DISABLED);
    mbedtls_ssl_conf_session_tickets(&s->config, MBEDTLS_SSL_SESSION_TICKETS_DISABLED);
    mbedtls_ssl_conf_verify(&s->config, on_verify, s);
    if (alpn_len > 0) ret = mbedtls_ssl_conf_alpn_protocols(&s->config, s->alpn);
  }
  if (ret == 0) ret = mbedtls_ssl_setup(&s->ssl, &s->config);
  int no_name = s->ip_len || !s->host[0] || (flags & TLS_CLIENT_NO_SNI);
  if (ret == 0) ret = mbedtls_ssl_set_hostname(&s->ssl, no_name ? NULL : s->host);
  if (ret != 0) {
    last_error = ret;
    session_free(s);
    return NULL;
  }
  mbedtls_ssl_set_bio(&s->ssl, s, bio_send, bio_recv, NULL);
  return s;
}

/* The client's own chain (concatenated DER, its leaf first) and private key
 * (PEM or DER; `pass` decrypts an encrypted one), before the first
 * handshake: 0, or < 0. The key must match the leaf. The caller's buffers
 * hold key material: the engine wipes the key and passphrase bytes it was
 * given once parsed, and frees (zeroizes) its copy with the session. */
EMSCRIPTEN_KEEPALIVE int tls_client_cert(session *s, const unsigned char *chain, size_t chain_len,
                                         unsigned char *key, size_t key_len, unsigned char *pass,
                                         size_t pass_len) {
  int ret = TLS_BADARG;
  int mine = 0;
  if (s->own_set || s->leaf || s->started || chain_len == 0 || key_len == 0) goto done;
  mbedtls_x509_crt_init(&s->own_chain);
  mbedtls_pk_init(&s->own_key);
  s->own_set = mine = 1;
  for (size_t at = 0; at < chain_len;) {
    unsigned char *p = (unsigned char *)chain + at;
    unsigned char *start = p;
    size_t body;
    ret = mbedtls_asn1_get_tag(&p, (unsigned char *)chain + chain_len, &body,
                               MBEDTLS_ASN1_CONSTRUCTED | MBEDTLS_ASN1_SEQUENCE);
    if (ret != 0) goto done;
    size_t whole = (size_t)(p - start) + body;
    ret = mbedtls_x509_crt_parse_der(&s->own_chain, start, whole);
    if (ret != 0) goto done;
    at += whole;
  }
  ret = mbedtls_pk_parse_key(&s->own_key, key, key_len, pass_len ? pass : NULL, pass_len);
  if (ret == 0 && mbedtls_pk_check_pair(&s->own_chain.pk, &s->own_key) != 0) ret = TLS_BADARG;
  if (ret == 0) ret = mbedtls_ssl_conf_own_cert(&s->config, &s->own_chain, &s->own_key);
done:
  if (key) mbedtls_platform_zeroize(key, key_len);
  if (pass) mbedtls_platform_zeroize(pass, pass_len);
  if (ret != 0) {
    if (mine) {
      mbedtls_x509_crt_free(&s->own_chain);
      mbedtls_pk_free(&s->own_key);
      s->own_set = 0;
    }
    return last_error = ret;
  }
  return 0;
}

/* 1 when the leaf did not match the server name. Under TLS_CLIENT_VERIFY_CHAIN_ONLY
 * this is the check the verification result left out: the caller MUST check the
 * server's identity itself (e.g. Node's checkServerIdentity). */
EMSCRIPTEN_KEEPALIVE int tls_name_mismatch(session *s) { return s->name_mismatch; }

/* The negotiated ciphersuite's IANA number, 0 before the handshake. */
EMSCRIPTEN_KEEPALIVE int tls_ciphersuite(session *s) {
  if (!mbedtls_ssl_is_handshake_over(&s->ssl)) return 0;
  return mbedtls_ssl_get_ciphersuite_id_from_ssl(&s->ssl);
}

/* Drive the handshake: 1 when it is done, 0 when it needs more ciphertext
 * (drain tls_out first), or an error (a refused certificate is
 * MBEDTLS_ERR_X509_CERT_VERIFY_FAILED; tls_verify_result says why). */
EMSCRIPTEN_KEEPALIVE int tls_handshake(session *s) {
  s->started = 1;
  for (;;) {
    if (mbedtls_ssl_is_handshake_over(&s->ssl)) return 1;
    int ret = mbedtls_ssl_handshake(&s->ssl);
    if (ret == 0) return 1;
    if (ret == MBEDTLS_ERR_SSL_RECEIVED_NEW_SESSION_TICKET) continue;
    if (want(ret)) return 0;
    return last_error = ret;
  }
}

/* Mbed TLS's verification flags (MBEDTLS_X509_BADCERT_*): 0 when the chain
 * verified, -1 before the server's certificate arrived. */
EMSCRIPTEN_KEEPALIVE int tls_verify_result(session *s) {
  return (int)mbedtls_ssl_get_verify_result(&s->ssl);
}

/* The verification flags in words, one reason per line. */
EMSCRIPTEN_KEEPALIVE int tls_verify_info(int flags, char *out, size_t max) {
  return mbedtls_x509_crt_verify_info(out, max, "", (uint32_t)flags);
}

/* The protocol ALPN agreed on, at the start of `out`: its length, or 0 for none. */
EMSCRIPTEN_KEEPALIVE int tls_alpn(session *s, char *out, size_t max) {
  const char *p = mbedtls_ssl_get_alpn_protocol(&s->ssl);
  if (!p) return 0;
  size_t n = strlen(p);
  if (n > max) return TLS_BADARG;
  memcpy(out, p, n);
  return (int)n;
}

static const mbedtls_x509_crt *peer_chain(session *s) { return mbedtls_ssl_get_peer_cert(&s->ssl); }

/* How many certificates the server sent. */
EMSCRIPTEN_KEEPALIVE int tls_peer_count(session *s) {
  int n = 0;
  for (const mbedtls_x509_crt *c = peer_chain(s); c && c->raw.p; c = c->next) n++;
  return n;
}

/* The server's certificate at `index` (0 = its leaf) as DER: its length, or < 0. */
EMSCRIPTEN_KEEPALIVE int tls_peer_der(session *s, int index, unsigned char *out, size_t max) {
  const mbedtls_x509_crt *c = peer_chain(s);
  for (int i = 0; c && c->raw.p && i < index; i++) c = c->next;
  if (index < 0 || !c || !c->raw.p) return TLS_BADARG;
  if (c->raw.len > max) return TLS_NOMEM;
  memcpy(out, c->raw.p, c->raw.len);
  return (int)c->raw.len;
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

/* Plaintext from the peer: > 0 bytes, 0 when more ciphertext is needed, TLS_EOF, or an error. */
EMSCRIPTEN_KEEPALIVE int tls_read(session *s, unsigned char *out, size_t max) {
  s->started = 1;
  for (int spins = 0;; spins++) {
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
    /* A client's TLS 1.3 NewSessionTickets (two may share a record) each end a
     * read with WANT_READ while the data behind them is already buffered: go
     * on while ciphertext or a record is waiting (homescoop#1032). */
    if (want(ret) && spins < 64 && (s->in_len > 0 || mbedtls_ssl_check_pending(&s->ssl))) continue;
    if (want(ret)) return 0;
    return last_error = ret;
  }
}

/* Encrypt up to `len` bytes of plaintext: how many were taken (0: drain tls_out and retry), or an error. */
EMSCRIPTEN_KEEPALIVE int tls_write(session *s, const unsigned char *bytes, size_t len) {
  s->started = 1;
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
