// wasix-libsodium probe: known answers for the primitives PyNaCl binds,
// against vectors from RFC 8032 (Ed25519), RFC 7748 (X25519), RFC 8439
// (ChaCha20-Poly1305), RFC 7914 (scrypt), and from Node's crypto (BLAKE2b,
// Argon2i/Argon2id) and a native libsodium (XSalsa20-Poly1305 box and
// secretbox, a sealed box made off-target, randombytes_buf_deterministic,
// SipHash-2-4). Then randombytes (WASI random_get through arc4random_buf),
// sealed-box round trip, pwhash_str, secretstream, and sodium_init plus
// signing from four threads. Prints "sodiumprobe ok".
#include <errno.h>
#include <pthread.h>
#include <sys/wait.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>
#include <sodium.h>

#define CHECK(c, m) do { if (!(c)) { printf("FAIL %s\n", m); return 1; } } while (0)

#define ALICE_PK "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a"
#define BOB_PK "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f"
#define SHARED "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742"
#define BOX "c0de8dbcd0a9299eae9ff07ebf65106f6d213dc068153a1230a7ef1fd0e3c0f38dabbb931a83c5f817f34c54295d803c6b6cc40cece3"
#define SECRETBOX "8b024e695d62187c3d9a886c89c17e6a3690552ab4a9cd7fcb1cf85f1be632ba3ecc24ace341569a7a820cfa3ab0cfc1e2b586a220c2"
#define SEALED "15a285f5179d781852a9546d57f4c1c178bc887f5566e8688a622f56f680152e8e4a137642510cf188592e9fa02f7785048f182765a4fc7df6a98532bb1feb686a87bf78e57a2a914ab3a0817aade3ca9933bbaa222c"
#define GENERICHASH "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923"
#define GENERICHASH_KEYED "d63a32d3e44738d7907f964316c241adaba0abfeabc32349677578a15a203f7f"
#define DRBG "0d8e6cc68715648926732e7ea73250cfaf2d58422083904c841a8ba33b986111f346ba50723a68ae283524a6bded09f83be6b80595856f72e25b86918e8b114b"
#define SHORTHASH "2d95855fa71c5cfc"
#define ARGON2ID "77af1c306ae70c8ad00394b671ee364ffb2e7e12f88e5045953b12dd0ccaa9db"
#define ARGON2I "a7b9b28d4d88a05413c6201707c686dab6ef0bd238ee40a5ff232c185d986c98"
#define ARGON2ID_INTERACTIVE "9aab5a81db651bf866ff7b6169794d2ad9bb00f3d95177925a5fca692a34dbd1"
#define SCRYPT "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640"
#define AEAD "d31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d63dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b3692ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc3ff4def08e4b7a9de576d26586cec64b61161ae10b594f09e26a7e902ecbd0600691"
#define ED_PK1 "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
#define ED_SIG1 "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
#define ED_PK2 "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c"
#define ED_SIG2 "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00"
#define ED_X25519_PK2 "25c704c594b88afc00a76b69d1ed2b984d7e22550f3ed0802d04fbcd07d38d47"
#define MSG "homescoop wasix-libsodium known answer"
#define AEAD_PT "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it."

static const unsigned char ALICE_SK[32] = {0x77,0x07,0x6d,0x0a,0x73,0x18,0xa5,0x7d,0x3c,0x16,0xc1,0x72,0x51,0xb2,0x66,0x45,0xdf,0x4c,0x2f,0x87,0xeb,0xc0,0x99,0x2a,0xb1,0x77,0xfb,0xa5,0x1d,0xb9,0x2c,0x2a};
static const unsigned char BOB_SK[32] = {0x5d,0xab,0x08,0x7e,0x62,0x4a,0x8a,0x4b,0x79,0xe1,0x7f,0x8b,0x83,0x80,0x0e,0xe6,0x6f,0x3b,0xb1,0x29,0x26,0x18,0xb6,0xfd,0x1c,0x2f,0x8b,0x27,0xff,0x88,0xe0,0xeb};

static unsigned char seq[64];
static char hexbuf[1024];

static const char *hex(const unsigned char *b, size_t n) {
  return sodium_bin2hex(hexbuf, sizeof hexbuf, b, n);
}
static int eq(const unsigned char *b, size_t n, const char *want) {
  return strlen(want) == 2 * n && strcmp(hex(b, n), want) == 0;
}
static size_t unhex(unsigned char *out, size_t max, const char *h) {
  size_t n = 0;
  if (sodium_hex2bin(out, max, h, strlen(h), NULL, &n, NULL) != 0) return 0;
  return n;
}

static int sign_ok[4];
static void *signer(void *arg) {
  int i = (int)(size_t)arg, r;
  unsigned char pk[32], sk[64], seed[32], sig[64], want[64], m = 0x72;
  size_t n = 0;
  (void)sodium_init();
  /* Thread-local buffers only: hexbuf is shared. */
  if (sodium_hex2bin(seed, 32, "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb", 64, NULL, &n, NULL) != 0 || n != 32) return NULL;
  if (sodium_hex2bin(want, 64, ED_SIG2, 128, NULL, &n, NULL) != 0 || n != 64) return NULL;
  for (r = 0; r < 50; r++) {
    crypto_sign_seed_keypair(pk, sk, seed);
    crypto_sign_detached(sig, NULL, &m, 1, sk);
    if (memcmp(sig, want, 64) != 0 || crypto_sign_verify_detached(sig, &m, 1, pk) != 0) return NULL;
  }
  sign_ok[i] = 1;
  return NULL;
}

int main(void) {
  unsigned char buf[256], buf2[256], pk[64], sk[64], k[32];
  unsigned long long blen;
  size_t i, n;
  for (i = 0; i < sizeof seq; i++) seq[i] = (unsigned char)i;
  CHECK(sodium_init() >= 0, "sodium_init");
  CHECK(sodium_init() == 1, "sodium_init twice is 1");
  printf("libsodium %s\n", sodium_version_string());
  CHECK(sodium_library_minimal() == 0, "full build");

  /* randombytes: the system RNG (arc4random_buf -> random_get) */
  printf("randombytes %s\n", randombytes_implementation_name());
  randombytes_buf(buf, 32);
  randombytes_buf(buf2, 32);
  CHECK(!sodium_is_zero(buf, 32) && memcmp(buf, buf2, 32) != 0, "randombytes_buf twice: non-zero, different");
  for (i = 0; i < 1000; i++) CHECK(randombytes_uniform(10) < 10, "randombytes_uniform");
  /* wasix-libc's arc4random_buf is a per-thread ChaCha20 state keyed once
     from random_get, with no fork handling: a forked child would repeat the
     parent's stream. slicc-kernel has no fork today (ENOSYS); if it gets one,
     this fails until the RNG is reseeded across fork. */
  {
    int fd[2];
    pid_t p;
    CHECK(pipe(fd) == 0, "pipe");
    fflush(stdout);
    p = fork();
    if (p == 0) {
      randombytes_buf(buf, 32);
      _exit(write(fd[1], buf, 32) == 32 ? 0 : 1);
    }
    if (p < 0) {
      printf("fork unavailable (%s)\n", strerror(errno));
    } else {
      int st = 0;
      CHECK(read(fd[0], buf2, 32) == 32, "read the child's bytes");
      randombytes_buf(buf, 32);
      waitpid(p, &st, 0);
      CHECK(memcmp(buf, buf2, 32) != 0, "fork: parent and child draw different bytes");
      printf("fork: parent and child draw different bytes\n");
    }
    close(fd[0]);
    close(fd[1]);
  }
  randombytes_buf_deterministic(buf, 64, seq);
  CHECK(eq(buf, 64, DRBG), "randombytes_buf_deterministic (ChaCha20)");

  /* hashes */
  crypto_hash_sha256(buf, (const unsigned char *)"abc", 3);
  CHECK(eq(buf, 32, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"), "sha256");
  crypto_hash_sha512(buf, (const unsigned char *)"abc", 3);
  CHECK(eq(buf, 64, "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f"), "sha512");
  crypto_generichash(buf, 64, (const unsigned char *)"abc", 3, NULL, 0);
  CHECK(eq(buf, 64, GENERICHASH), "generichash blake2b-512");
  crypto_generichash(buf, 32, (const unsigned char *)"abc", 3, seq, 32);
  CHECK(eq(buf, 32, GENERICHASH_KEYED), "generichash keyed");
  crypto_shorthash(buf, (const unsigned char *)MSG, strlen(MSG), seq);
  CHECK(eq(buf, 8, SHORTHASH), "shorthash siphash24");

  /* X25519 (RFC 7748) and crypto_box / secretbox (XSalsa20-Poly1305) */
  crypto_scalarmult_base(pk, ALICE_SK);
  CHECK(eq(pk, 32, ALICE_PK), "scalarmult_base alice");
  crypto_scalarmult_base(pk + 32, BOB_SK);
  CHECK(eq(pk + 32, 32, BOB_PK), "scalarmult_base bob");
  CHECK(crypto_scalarmult(buf, ALICE_SK, pk + 32) == 0 && eq(buf, 32, SHARED), "scalarmult shared");
  CHECK(crypto_box_easy(buf, (const unsigned char *)MSG, strlen(MSG), seq, pk + 32, ALICE_SK) == 0, "box_easy");
  CHECK(eq(buf, strlen(MSG) + crypto_box_MACBYTES, BOX), "box known answer");
  CHECK(crypto_box_open_easy(buf2, buf, strlen(MSG) + crypto_box_MACBYTES, seq, pk, BOB_SK) == 0 && !memcmp(buf2, MSG, strlen(MSG)), "box_open");
  buf[3] ^= 1;
  CHECK(crypto_box_open_easy(buf2, buf, strlen(MSG) + crypto_box_MACBYTES, seq, pk, BOB_SK) != 0, "tampered box fails");
  crypto_secretbox_easy(buf, (const unsigned char *)MSG, strlen(MSG), seq, seq);
  CHECK(eq(buf, strlen(MSG) + crypto_secretbox_MACBYTES, SECRETBOX), "secretbox known answer");
  CHECK(crypto_secretbox_open_easy(buf2, buf, strlen(MSG) + crypto_secretbox_MACBYTES, seq, seq) == 0 && !memcmp(buf2, MSG, strlen(MSG)), "secretbox_open");
  buf[0] ^= 0x80;
  CHECK(crypto_secretbox_open_easy(buf2, buf, strlen(MSG) + crypto_secretbox_MACBYTES, seq, seq) != 0, "tampered secretbox fails");

  /* sealed box: open one sealed off-target, then a round trip */
  n = unhex(buf, sizeof buf, SEALED);
  CHECK(n == strlen(MSG) + crypto_box_SEALBYTES, "sealed length");
  CHECK(crypto_box_seal_open(buf2, buf, n, pk + 32, BOB_SK) == 0 && !memcmp(buf2, MSG, strlen(MSG)), "seal_open known");
  CHECK(crypto_box_seal_open(buf2, buf, n, pk, ALICE_SK) != 0, "seal_open with the wrong key fails");
  CHECK(crypto_box_keypair(pk, sk) == 0, "box_keypair");
  CHECK(crypto_box_seal(buf, (const unsigned char *)MSG, strlen(MSG), pk) == 0, "seal");
  CHECK(crypto_box_seal_open(buf2, buf, strlen(MSG) + crypto_box_SEALBYTES, pk, sk) == 0 && !memcmp(buf2, MSG, strlen(MSG)), "seal round trip");

  /* Ed25519 (RFC 8032 tests 1 and 2) */
  unhex(k, 32, "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
  crypto_sign_seed_keypair(pk, sk, k);
  CHECK(eq(pk, 32, ED_PK1), "ed25519 pk 1");
  crypto_sign_detached(buf, NULL, (const unsigned char *)"", 0, sk);
  CHECK(eq(buf, 64, ED_SIG1), "ed25519 sig 1");
  unhex(k, 32, "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb");
  crypto_sign_seed_keypair(pk, sk, k);
  CHECK(eq(pk, 32, ED_PK2), "ed25519 pk 2");
  buf2[0] = 0x72;
  CHECK(crypto_sign(buf, &blen, buf2, 1, sk) == 0 && blen == 65 && eq(buf, 64, ED_SIG2), "ed25519 sig 2 (combined)");
  CHECK(crypto_sign_open(buf2 + 1, &blen, buf, 65, pk) == 0 && blen == 1 && buf2[1] == 0x72, "sign_open");
  buf[64] ^= 1;
  CHECK(crypto_sign_open(buf2 + 1, &blen, buf, 65, pk) != 0, "tampered message fails verify");
  CHECK(crypto_sign_ed25519_pk_to_curve25519(k, pk) == 0 && eq(k, 32, ED_X25519_PK2), "ed25519 pk to curve25519");

  /* ChaCha20-Poly1305 IETF (RFC 8439 2.8.2) */
  {
    unsigned char key[32], nonce[12], ad[12];
    unhex(key, 32, "808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f");
    unhex(nonce, 12, "070000004041424344454647");
    unhex(ad, 12, "50515253c0c1c2c3c4c5c6c7");
    crypto_aead_chacha20poly1305_ietf_encrypt(buf, &blen, (const unsigned char *)AEAD_PT, strlen(AEAD_PT), ad, 12, NULL, nonce, key);
    CHECK(eq(buf, (size_t)blen, AEAD), "chacha20poly1305 ietf (RFC 8439)");
    CHECK(crypto_aead_chacha20poly1305_ietf_decrypt(buf2, &blen, NULL, buf, blen, ad, 12, nonce, key) == 0 && !memcmp(buf2, AEAD_PT, strlen(AEAD_PT)), "aead decrypt");
  }

  /* pwhash: Argon2id / Argon2i at 8 MiB, Argon2id INTERACTIVE (64 MiB), scrypt (RFC 7914) */
  CHECK(crypto_pwhash(buf, 32, "correct horse", 13, seq, 3, 8u << 20, crypto_pwhash_ALG_ARGON2ID13) == 0 && eq(buf, 32, ARGON2ID), "argon2id 8 MiB");
  CHECK(crypto_pwhash(buf, 32, "correct horse", 13, seq, 3, 8u << 20, crypto_pwhash_ALG_ARGON2I13) == 0 && eq(buf, 32, ARGON2I), "argon2i 8 MiB");
  CHECK(crypto_pwhash(buf, 32, "correct horse", 13, seq, crypto_pwhash_argon2id_OPSLIMIT_INTERACTIVE, crypto_pwhash_argon2id_MEMLIMIT_INTERACTIVE, crypto_pwhash_ALG_ARGON2ID13) == 0
        && eq(buf, 32, ARGON2ID_INTERACTIVE), "argon2id INTERACTIVE 64 MiB");
  CHECK(crypto_pwhash_scryptsalsa208sha256_ll((const uint8_t *)"password", 8, (const uint8_t *)"NaCl", 4, 1024, 8, 16, buf, 64) == 0 && eq(buf, 64, SCRYPT), "scrypt RFC 7914");
  {
    char str[crypto_pwhash_STRBYTES];
    CHECK(crypto_pwhash_str(str, "pw", 2, 2, 8u << 20) == 0 && !strncmp(str, "$argon2id$v=19$m=8192,t=2,p=1$", 30), "pwhash_str");
    CHECK(crypto_pwhash_str_verify(str, "pw", 2) == 0 && crypto_pwhash_str_verify(str, "px", 2) != 0, "pwhash_str_verify");
  }

  /* secretstream */
  {
    crypto_secretstream_xchacha20poly1305_state st;
    unsigned char hdr[crypto_secretstream_xchacha20poly1305_HEADERBYTES], tag;
    crypto_secretstream_xchacha20poly1305_keygen(k);
    crypto_secretstream_xchacha20poly1305_init_push(&st, hdr, k);
    crypto_secretstream_xchacha20poly1305_push(&st, buf, NULL, (const unsigned char *)"one", 3, NULL, 0, 0);
    crypto_secretstream_xchacha20poly1305_push(&st, buf + 64, NULL, (const unsigned char *)"two", 3, NULL, 0, crypto_secretstream_xchacha20poly1305_TAG_FINAL);
    CHECK(crypto_secretstream_xchacha20poly1305_init_pull(&st, hdr, k) == 0, "init_pull");
    CHECK(crypto_secretstream_xchacha20poly1305_pull(&st, buf2, NULL, &tag, buf, 3 + crypto_secretstream_xchacha20poly1305_ABYTES, NULL, 0) == 0 && !memcmp(buf2, "one", 3) && tag == 0, "pull 1");
    CHECK(crypto_secretstream_xchacha20poly1305_pull(&st, buf2, NULL, &tag, buf + 64, 3 + crypto_secretstream_xchacha20poly1305_ABYTES, NULL, 0) == 0 && !memcmp(buf2, "two", 3)
          && tag == crypto_secretstream_xchacha20poly1305_TAG_FINAL, "pull final");
  }

  /* four threads: sodium_init and signing at once */
  {
    pthread_t t[4];
    for (i = 0; i < 4; i++) CHECK(pthread_create(&t[i], NULL, signer, (void *)i) == 0, "pthread_create");
    for (i = 0; i < 4; i++) pthread_join(t[i], NULL);
    for (i = 0; i < 4; i++) CHECK(sign_ok[i], "threaded ed25519 signatures");
  }
  printf("sodiumprobe ok\n");
  return 0;
}
