// wasix-openssl probe: libcrypto known answers (SHA-256, AES-256-GCM,
// ECDSA P-256 and RSA-2048 verify of fixed signatures), RAND_bytes, and a
// TLS 1.3 handshake over a memory BIO pair with an in-process self-signed
// certificate, and BIO calls whose signatures carry long / size_t / off_t
// (a header/library mismatch there links a trapping stub). Prints one
// "ok <check>" line per check and "sslprobe ok".
#include <openssl/bio.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/pem.h>
#include <openssl/rand.h>
#include <openssl/ssl.h>
#include <openssl/x509.h>
#include <stdio.h>
#include <string.h>

static int fails;
#define CHECK(c, m) do { if (c) printf("ok %s\n", m); else { printf("FAIL %s\n", m); ERR_print_errors_fp(stdout); fails++; } } while (0)

static size_t unhex(const char *h, unsigned char *out) {
  size_t n = strlen(h) / 2;
  for (size_t i = 0; i < n; i++) sscanf(h + 2 * i, "%2hhx", &out[i]);
  return n;
}

static const char MSG[] = "homescoop wasix-openssl probe";
// Generated with Node's crypto (an independent implementation).
static const char EC_PUB[] = "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEZOUCUgn66vtKxbYm5M0edNUGHqqj\nyyYCvA7uv82NBgfNZxmG8GN4uip1zLG6tPD2wArRP8TYVjLENKXPxLCdng==\n-----END PUBLIC KEY-----\n";
static const char EC_SIG[] = "30440220258bbab0352fb4ebdfac0facacdde253b87e4ba7a491060b3f222e3b0aa54648022071cbdc783035e388d89cbccec263404c444ed722df95839aca044166a16fb895";
static const char RSA_PUB[] = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw0Hffb4lcG7FVjlyIY0O\nnO48+AEjDsu1zvuK7oX8QPKJyBc58S0ZmXSRpFmN2Qbth+ogvG9DAvPWdYFIHvVG\nk2kCZwtfN60LcHoBqrJcUtvsO1dX5E5e8HIyklLqt92mjHFmt3o1GlcKNdqqtYm1\nrp5zZNhEDMBskh3CyvPOHgILeZsRH+xOLMk8w/W84qwfAnaTvUCf6W3EH0QvpsTs\nHxrq5VRZYjmrU8m2D4+oRxKBNulBZ0bh9RxMg52xy0OOlgI6GHVfSU3EWoWiULq6\nLzbh5HPaRfVCc49sFtI5g903pBP88PmfsWKZHAdYU2ofTKZguNqFde4vx3XGDqpj\nqQIDAQAB\n-----END PUBLIC KEY-----\n";
static const char RSA_SIG[] = "7a40209224127ad71549158fafc6790ddaa75a30d326d4cb926d0f5434d75c46bd8f64b25b811398be9121bcc311de9ce3a52f5a55ca7ebd51e9f9d3190a41470ca026a349e90a6805d30e65a4562a1cc63d5d59fa3631c8ed7aa6483b2b816a0cd6e1fa6d193609843fe061b2b4e3fd10277955a265b58bedd177d434ce01d4729a50c1c282c980627a43a7f4eb08a471e031e08a0c4424e4307a20897db59f65cc41bdda9a6a2daefd0b45213c875b303db0c40992a3aa6e76ba39b2a5e44c2a30069a24c7bb8766683c750ad3f270907ce3d08af95f12eb62c2d683787781833ef5c40a52a7a830cd39b4ed6b15781c086c30110e3185028c56f648e029c5";

static int verify(const char *pem, const char *sighex, const char *msg) {
  BIO *b = BIO_new_mem_buf(pem, -1);
  EVP_PKEY *k = PEM_read_bio_PUBKEY(b, NULL, NULL, NULL);
  BIO_free(b);
  if (!k) return -1;
  unsigned char sig[512];
  size_t n = unhex(sighex, sig);
  EVP_MD_CTX *c = EVP_MD_CTX_new();
  int r = EVP_DigestVerifyInit(c, NULL, EVP_sha256(), NULL, k) == 1
       && EVP_DigestVerify(c, sig, n, (const unsigned char *)msg, strlen(msg)) == 1;
  EVP_MD_CTX_free(c);
  EVP_PKEY_free(k);
  return r;
}

static void gcm(void) {
  unsigned char key[32], iv[12], pt[60], aad[20], want[60], tag[16], out[64], got[16];
  unhex("feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308", key);
  unhex("cafebabefacedbaddecaf888", iv);
  unhex("d9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39", pt);
  unhex("feedfacedeadbeeffeedfacedeadbeefabaddad2", aad);
  unhex("522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662", want);
  unhex("76fc6ece0f4e1768cddf8853bb2d551b", tag);
  EVP_CIPHER_CTX *c = EVP_CIPHER_CTX_new();
  int n = 0, f = 0;
  int ok = EVP_EncryptInit_ex(c, EVP_aes_256_gcm(), NULL, key, iv)
        && EVP_EncryptUpdate(c, NULL, &n, aad, sizeof aad)
        && EVP_EncryptUpdate(c, out, &n, pt, sizeof pt)
        && EVP_EncryptFinal_ex(c, out + n, &f)
        && EVP_CIPHER_CTX_ctrl(c, EVP_CTRL_GCM_GET_TAG, 16, got);
  CHECK(ok && n + f == 60 && !memcmp(out, want, 60) && !memcmp(got, tag, 16), "aes-256-gcm encrypt (GCM spec test case 16)");
  // Decrypt with a flipped tag bit must fail.
  got[0] ^= 1;
  EVP_CIPHER_CTX_reset(c);
  ok = EVP_DecryptInit_ex(c, EVP_aes_256_gcm(), NULL, key, iv)
    && EVP_DecryptUpdate(c, NULL, &n, aad, sizeof aad)
    && EVP_DecryptUpdate(c, out, &n, want, sizeof want)
    && EVP_CIPHER_CTX_ctrl(c, EVP_CTRL_GCM_SET_TAG, 16, got)
    && EVP_DecryptFinal_ex(c, out + n, &f) == 1;
  CHECK(!ok, "aes-256-gcm rejects a bad tag");
  EVP_CIPHER_CTX_free(c);
  ERR_clear_error();
}

static EVP_PKEY *selfsigned(X509 **cert) {
  EVP_PKEY *k = EVP_PKEY_Q_keygen(NULL, NULL, "EC", "P-256");
  X509 *x = X509_new();
  X509_set_version(x, 2);
  ASN1_INTEGER_set(X509_get_serialNumber(x), 1);
  X509_gmtime_adj(X509_getm_notBefore(x), -60);
  X509_gmtime_adj(X509_getm_notAfter(x), 3600);
  X509_NAME *nm = X509_get_subject_name(x);
  X509_NAME_add_entry_by_txt(nm, "CN", MBSTRING_ASC, (const unsigned char *)"probe.test", -1, -1, 0);
  X509_set_issuer_name(x, nm);
  X509_set_pubkey(x, k);
  X509_sign(x, k, EVP_sha256());
  *cert = x;
  return k;
}

static void tls(void) {
  X509 *cert;
  EVP_PKEY *key = selfsigned(&cert);
  SSL_CTX *sctx = SSL_CTX_new(TLS_server_method()), *cctx = SSL_CTX_new(TLS_client_method());
  SSL_CTX_set_min_proto_version(sctx, TLS1_3_VERSION);
  SSL_CTX_set_min_proto_version(cctx, TLS1_3_VERSION);
  int ok = SSL_CTX_use_certificate(sctx, cert) == 1 && SSL_CTX_use_PrivateKey(sctx, key) == 1;
  X509_STORE_add_cert(SSL_CTX_get_cert_store(cctx), cert);
  SSL_CTX_set_verify(cctx, SSL_VERIFY_PEER, NULL);
  SSL *s = SSL_new(sctx), *c = SSL_new(cctx);
  SSL_set1_host(c, "probe.test");
  BIO *bs, *bc;
  BIO_new_bio_pair(&bs, 0, &bc, 0);
  SSL_set_bio(s, bs, bs);
  SSL_set_bio(c, bc, bc);
  SSL_set_accept_state(s);
  SSL_set_connect_state(c);
  int cdone = 0, sdone = 0;
  for (int i = 0; i < 50 && !(cdone && sdone); i++) {
    if (!cdone) cdone = SSL_do_handshake(c) == 1;
    if (!sdone) sdone = SSL_do_handshake(s) == 1;
  }
  CHECK(ok && cdone && sdone, "tls handshake over a memory BIO pair");
  CHECK(SSL_version(c) == TLS1_3_VERSION, "tls 1.3");
  CHECK(SSL_get_verify_result(c) == X509_V_OK, "client verified the self-signed cert (probe.test)");
  printf("cipher %s\n", SSL_get_cipher_name(c));
  char buf[16] = {0};
  int w = SSL_write(c, "ping", 4);
  int r = SSL_read(s, buf, sizeof buf - 1);
  CHECK(w == 4 && r == 4 && !strcmp(buf, "ping"), "client to server application data");
  memset(buf, 0, sizeof buf);
  w = SSL_write(s, "pong", 4);
  r = SSL_read(c, buf, sizeof buf - 1);
  CHECK(w == 4 && r == 4 && !strcmp(buf, "pong"), "server to client application data");
  SSL_free(c);
  SSL_free(s);
  SSL_CTX_free(cctx);
  SSL_CTX_free(sctx);
  X509_free(cert);
  EVP_PKEY_free(key);
}

static void bio(void) {
  // A file BIO: BIO_seek/BIO_tell carry long offsets through BIO_ctrl.
  BIO *f = BIO_new_file("bio-probe.bin", "w+b");
  int ok = f != NULL;
  for (int i = 0; ok && i < 100; i++) ok = BIO_write(f, "0123456789", 10) == 10;
  CHECK(ok && BIO_flush(f) == 1, "file BIO write");
  CHECK(BIO_seek(f, 437) == 0 && BIO_tell(f) == 437, "BIO_seek / BIO_tell");
  char c[4] = {0};
  CHECK(BIO_read(f, c, 3) == 3 && !strcmp(c, "789"), "read after BIO_seek");
  CHECK(BIO_tell(f) == 440, "BIO_tell after read");
  BIO_free(f);
  // A memory BIO: long and size_t returns.
  BIO *m = BIO_new(BIO_s_mem());
  BIO_write(m, "hello, wasix", 12);
  char *data = NULL;
  long n = BIO_get_mem_data(m, &data);
  CHECK(n == 12 && data && !memcmp(data, "hello, wasix", 12), "BIO_get_mem_data (long)");
  CHECK(BIO_ctrl_pending(m) == (size_t)12, "BIO_ctrl_pending (size_t)");
  CHECK(BIO_ctrl(m, BIO_CTRL_EOF, 0L, NULL) == 0L, "BIO_ctrl (long)");
  char buf[16];
  CHECK(BIO_read(m, buf, sizeof buf) == 12 && BIO_ctrl(m, BIO_CTRL_EOF, 0L, NULL) == 1L, "BIO_ctrl EOF after drain");
  BIO_free(m);
}

int main(void) {
  printf("%s\n", OpenSSL_version(OPENSSL_VERSION));
  unsigned char md[32], want[32];
  unsigned int mdlen = 0;
  unhex("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", want);
  CHECK(EVP_Digest("abc", 3, md, &mdlen, EVP_sha256(), NULL) && mdlen == 32 && !memcmp(md, want, 32), "sha256(abc)");
  gcm();
  CHECK(verify(EC_PUB, EC_SIG, MSG) == 1, "ecdsa p-256 verify");
  CHECK(verify(EC_PUB, EC_SIG, "tampered") == 0, "ecdsa p-256 rejects a tampered message");
  CHECK(verify(RSA_PUB, RSA_SIG, MSG) == 1, "rsa-2048 pkcs1 sha256 verify");
  CHECK(verify(RSA_PUB, RSA_SIG, "tampered") == 0, "rsa-2048 rejects a tampered message");
  ERR_clear_error();
  unsigned char r1[32] = {0}, r2[32] = {0}, zero[32] = {0};
  CHECK(RAND_bytes(r1, 32) == 1 && RAND_bytes(r2, 32) == 1 && memcmp(r1, zero, 32) && memcmp(r1, r2, 32), "RAND_bytes (WASI random_get)");
  bio();
  tls();
  if (fails) {
    printf("%d failed\n", fails);
    return 1;
  }
  printf("sslprobe ok\n");
  return 0;
}
