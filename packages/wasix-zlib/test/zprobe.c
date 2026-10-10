// wasix-zlib probe: deflate/inflate round trip of a known buffer, crc32 and
// adler32 of a known vector, crc32_combine/adler32_combine, gzip through a
// file with gzseek/gztell/gzoffset (the z_off_t signatures: a z_off_t that
// differs between library and header links a trapping stub). Prints
// "zprobe ok".
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
  // Combine: the checksum of "123456789" from "1234" + "56789".
  uLong c1 = crc32(0, (const Bytef *)v, 4), c2 = crc32(0, (const Bytef *)v + 4, 5);
  CHECK(crc32_combine(c1, c2, 5) == 0xCBF43926u, "crc32_combine");
  uLong a1 = adler32(1, (const Bytef *)v, 4), a2 = adler32(1, (const Bytef *)v + 4, 5);
  CHECK(adler32_combine(a1, a2, 5) == 0x091E01DEu, "adler32_combine");
  // Seek in a real .gz: z_off_t positions in the uncompressed stream.
  g = gzopen("probe.gz", "rb");
  CHECK(g != NULL, "gzopen rb");
  CHECK(gzseek(g, 40000, SEEK_SET) == 40000, "gzseek SEEK_SET");
  CHECK(gztell(g) == 40000, "gztell");
  unsigned char part[100];
  CHECK(gzread(g, part, sizeof part) == (int)sizeof part && !memcmp(part, in + 40000, sizeof part), "read after gzseek");
  CHECK(gzseek(g, 1000, SEEK_CUR) == 41100 && gztell(g) == 41100, "gzseek SEEK_CUR");
  z_off_t off = gzoffset(g);
  CHECK(off > 0 && off <= (z_off_t)clen + 64, "gzoffset");
  gzclose(g);
  printf("sizeof(z_off_t) %u\n", (unsigned)sizeof(z_off_t));
  printf("zlib %s\nzprobe ok\n", zlibVersion());
  return 0;
}
