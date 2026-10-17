#include <errno.h>
#include <iconv.h>
#include <stdio.h>
#include <string.h>

#define CHECK(c, m) do { if (!(c)) { printf("FAIL %s\n", m); return 1; } } while (0)

static size_t conv(const char *to, const char *from, const char *in, size_t inlen, char *out, size_t outcap, int *err) {
  iconv_t cd = iconv_open(to, from);
  if (cd == (iconv_t)-1) { *err = errno; return (size_t)-1; }
  char *ip = (char *)in, *op = out;
  size_t il = inlen, ol = outcap;
  size_t r = iconv(cd, &ip, &il, &op, &ol);
  *err = r == (size_t)-1 ? errno : 0;
  iconv_close(cd);
  return r == (size_t)-1 ? (size_t)-1 : outcap - ol;
}

int main(void) {
  const char *utf8 = "na\xc3\xafve caf\xc3\xa9 \xe2\x82\xac";
  char out[256], back[256];
  int err;
  size_t n = conv("ISO-8859-15", "UTF-8", utf8, strlen(utf8), out, sizeof out, &err);
  CHECK(n == 12 && !memcmp(out, "na\xefve caf\xe9 \xa4", 12), "UTF-8 -> ISO-8859-15 (euro is 0xa4)");
  size_t m = conv("UTF-8", "ISO-8859-15", out, n, back, sizeof back, &err);
  CHECK(m == strlen(utf8) && !memcmp(back, utf8, m), "ISO-8859-15 -> UTF-8 round trip");
  n = conv("UTF-16LE", "UTF-8", utf8, strlen(utf8), out, sizeof out, &err);
  CHECK(n == 24 && out[0] == 'n' && out[1] == 0 && (unsigned char)out[22] == 0xac && (unsigned char)out[23] == 0x20, "UTF-8 -> UTF-16LE");
  n = conv("SHIFT_JIS", "UTF-8", "\xe6\x97\xa5\xe6\x9c\xac", 6, out, sizeof out, &err);
  CHECK(n == 4 && !memcmp(out, "\x93\xfa\x96\x7b", 4), "UTF-8 -> SHIFT_JIS (CJK tables built in)");
  n = conv("ASCII", "UTF-8", utf8, strlen(utf8), out, sizeof out, &err);
  CHECK(n == (size_t)-1 && err == EILSEQ, "unrepresentable input is EILSEQ");
  n = conv("ASCII//TRANSLIT", "UTF-8", "caf\xc3\xa9", 5, out, sizeof out, &err);
  CHECK(n != (size_t)-1 && n >= 4 && !memcmp(out, "caf", 3), "//TRANSLIT");
  n = conv("UTF-8", "UTF-8", "\xc3", 1, out, sizeof out, &err);
  CHECK(n == (size_t)-1 && err == EINVAL, "truncated input is EINVAL");
  CHECK(iconv_open("NO-SUCH-CHARSET", "UTF-8") == (iconv_t)-1 && errno == EINVAL, "unknown charset is EINVAL");
  printf("libiconv %d.%d\n", _libiconv_version >> 8, _libiconv_version & 0xff);
  printf("probe ok\n");
  return 0;
}
