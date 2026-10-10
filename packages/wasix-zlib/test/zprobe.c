// wasix-zlib probe: deflate/inflate round trip of a known buffer, crc32 and
// adler32 of a known vector, gzip through a file. Prints "zprobe ok".
#include <stdio.h>
#include <string.h>
#include <zlib.h>

#define CHECK(c, m) do { if (!(c)) { printf("FAIL %s\n", m); return 1; } } while (0)

int main(void) {
  const char *v = "123456789";
  CHECK(crc32(0, (const Bytef *)v, 9) == 0xCBF43926u, "crc32");
  CHECK(adler32(1, (const Bytef *)v, 9) == 0x091E01DEu, "adler32");
  static unsigned char in[65536], comp[70000], out[65536];
  for (unsigned i = 0; i < sizeof in; i++) in[i] = (unsigned char)("homescoop"[i % 9] ^ (i >> 8));
  uLongf clen = sizeof comp, olen = sizeof out;
  CHECK(compress2(comp, &clen, in, sizeof in, 9) == Z_OK, "compress2");
  CHECK(clen < sizeof in / 4, "ratio");
  CHECK(uncompress(out, &olen, comp, clen) == Z_OK && olen == sizeof in, "uncompress");
  CHECK(memcmp(in, out, sizeof in) == 0, "round trip");
  gzFile g = gzopen("probe.gz", "wb9");
  CHECK(g && gzwrite(g, in, sizeof in) == (int)sizeof in && gzclose(g) == Z_OK, "gzwrite");
  g = gzopen("probe.gz", "rb");
  CHECK(g && gzread(g, out, sizeof out) == (int)sizeof out && gzclose(g) == Z_OK, "gzread");
  CHECK(memcmp(in, out, sizeof in) == 0, "gz round trip");
  printf("zlib %s\nzprobe ok\n", zlibVersion());
  return 0;
}
