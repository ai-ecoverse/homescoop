/* libiconv smoke: UTF-8 <-> encodings. Writes bins for host iconv cmp. */
#include <iconv.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int conv(const char *to, const char *from, const char *in, size_t inlen,
                char **out, size_t *outlen) {
  iconv_t cd = iconv_open(to, from);
  if (cd == (iconv_t)-1) {
    fprintf(stderr, "iconv_open(%s <- %s) failed errno=%d\n", to, from, errno);
    return 1;
  }
  size_t cap = inlen * 8 + 16;
  char *buf = malloc(cap);
  if (!buf) {
    iconv_close(cd);
    return 1;
  }
  char *inptr = (char *)in;
  size_t inleft = inlen;
  char *outptr = buf;
  size_t outleft = cap;
  if (iconv(cd, &inptr, &inleft, &outptr, &outleft) == (size_t)-1) {
    fprintf(stderr, "iconv(%s <- %s) errno=%d inleft=%zu\n", to, from, errno, inleft);
    free(buf);
    iconv_close(cd);
    return 1;
  }
  /* flush */
  if (iconv(cd, NULL, NULL, &outptr, &outleft) == (size_t)-1) {
    fprintf(stderr, "iconv flush(%s) errno=%d\n", to, errno);
    free(buf);
    iconv_close(cd);
    return 1;
  }
  iconv_close(cd);
  *outlen = cap - outleft;
  *out = buf;
  return 0;
}

static int write_bin(const char *dir, const char *name, const char *p, size_t n) {
  char path[512];
  snprintf(path, sizeof path, "%s/%s", dir, name);
  FILE *f = fopen(path, "wb");
  if (!f) return 1;
  if (fwrite(p, 1, n, f) != n) {
    fclose(f);
    return 1;
  }
  fclose(f);
  return 0;
}

static void hexdump(const char *label, const char *p, size_t n) {
  fprintf(stderr, "%s (%zu):", label, n);
  for (size_t i = 0; i < n && i < 64; i++) fprintf(stderr, " %02x", (unsigned char)p[i]);
  if (n > 64) fprintf(stderr, " …");
  fprintf(stderr, "\n");
}

int main(int argc, char **argv) {
  const char *dir = argc > 1 ? argv[1] : "/tmp";
  const char utf8_hello[] = "Hello";
  const char utf8_cafe[] = "caf\xc3\xa9"; /* café */
  const char utf8_jp[] = "\xe6\x97\xa5\xe6\x9c\xac\xe8\xaa\x9e"; /* 日本語 */

  struct {
    const char *enc;
    const char *utf8;
    size_t n;
    const char *tag;
  } cases[] = {
      {"SHIFT_JIS", utf8_jp, 9, "jp"},
      {"EUC-JP", utf8_jp, 9, "jp"},
      {"WINDOWS-1252", utf8_cafe, 5, "cafe"},
      {"ISO-8859-1", utf8_cafe, 5, "cafe"},
      {"UTF-16", utf8_hello, 5, "hello"},
      {"UTF-32", utf8_hello, 5, "hello"},
  };

  int fails = 0;
  for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
    char *fwd = NULL, *back = NULL;
    size_t fwdn = 0, backn = 0;
    if (conv(cases[i].enc, "UTF-8", cases[i].utf8, cases[i].n, &fwd, &fwdn)) {
      fails++;
      continue;
    }
    if (conv("UTF-8", cases[i].enc, fwd, fwdn, &back, &backn)) {
      free(fwd);
      fails++;
      continue;
    }
    char n1[64], n2[64];
    snprintf(n1, sizeof n1, "wasm-utf8-to-%s.bin", cases[i].enc);
    snprintf(n2, sizeof n2, "wasm-%s-to-utf8.bin", cases[i].enc);
    if (write_bin(dir, n1, fwd, fwdn) || write_bin(dir, n2, back, backn)) fails++;
    hexdump(n1, fwd, fwdn);
    hexdump(n2, back, backn);
    if (backn != cases[i].n || memcmp(back, cases[i].utf8, cases[i].n) != 0) {
      fprintf(stderr, "FAIL roundtrip %s\n", cases[i].enc);
      fails++;
    } else {
      fprintf(stderr, "ok wasm roundtrip UTF-8 <-> %s (%s)\n", cases[i].enc, cases[i].tag);
    }
    free(fwd);
    free(back);
  }
  if (fails) {
    fprintf(stderr, "libiconv smoke: %d failed\n", fails);
    return 1;
  }
  fprintf(stderr, "libiconv smoke: wasm roundtrips ok\n");
  return 0;
}
