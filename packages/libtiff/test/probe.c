#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <tiffio.h>
#include <zlib.h>
#include <jpeglib.h>

#define W 32
#define H 24
#define CHECK(c, m) do { if (!(c)) { printf("FAIL %s\n", m); return 1; } } while (0)

static const uint16_t COMP[] = {COMPRESSION_ADOBE_DEFLATE, COMPRESSION_LZW, COMPRESSION_JPEG, COMPRESSION_PACKBITS};
static const char *NAMES[] = {"deflate", "lzw", "jpeg", "packbits"};

static unsigned char px(int x, int y, int c) {
  return (unsigned char)(c == 0 ? x * 8 : c == 1 ? y * 10 : 128 + ((x + y) & 1) * 20);
}

int main(int argc, char **argv) {
  char path[512];
  snprintf(path, sizeof path, "%s/probe.tif", argc > 1 ? argv[1] : ".");
  static unsigned char rgb[H][W * 3];
  for (int y = 0; y < H; y++)
    for (int x = 0; x < W; x++)
      for (int c = 0; c < 3; c++) rgb[y][x * 3 + c] = px(x, y, c);

  TIFF *t = TIFFOpen(path, "w");
  CHECK(t, "TIFFOpen w");
  for (int p = 0; p < 4; p++) {
    TIFFSetField(t, TIFFTAG_IMAGEWIDTH, W);
    TIFFSetField(t, TIFFTAG_IMAGELENGTH, H);
    TIFFSetField(t, TIFFTAG_SAMPLESPERPIXEL, 3);
    TIFFSetField(t, TIFFTAG_BITSPERSAMPLE, 8);
    TIFFSetField(t, TIFFTAG_ORIENTATION, ORIENTATION_TOPLEFT);
    TIFFSetField(t, TIFFTAG_PLANARCONFIG, PLANARCONFIG_CONTIG);
    TIFFSetField(t, TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_RGB);
    TIFFSetField(t, TIFFTAG_COMPRESSION, COMP[p]);
    if (COMP[p] == COMPRESSION_JPEG) TIFFSetField(t, TIFFTAG_JPEGQUALITY, 95);
    if (COMP[p] != COMPRESSION_JPEG) TIFFSetField(t, TIFFTAG_PREDICTOR, PREDICTOR_HORIZONTAL);
    TIFFSetField(t, TIFFTAG_ROWSPERSTRIP, 8);
    TIFFSetField(t, TIFFTAG_IMAGEDESCRIPTION, NAMES[p]);
    for (int y = 0; y < H; y++) CHECK(TIFFWriteScanline(t, rgb[y], y, 0) == 1, NAMES[p]);
    CHECK(TIFFWriteDirectory(t), "TIFFWriteDirectory");
  }
  TIFFClose(t);

  t = TIFFOpen(path, "r");
  CHECK(t, "TIFFOpen r");
  CHECK(TIFFNumberOfDirectories(t) == 4, "four pages");
  for (int p = 0; p < 4; p++) {
    CHECK(TIFFSetDirectory(t, p), "TIFFSetDirectory");
    uint16_t comp = 0;
    char *desc = NULL;
    TIFFGetField(t, TIFFTAG_COMPRESSION, &comp);
    TIFFGetField(t, TIFFTAG_IMAGEDESCRIPTION, &desc);
    CHECK(comp == COMP[p] && desc && !strcmp(desc, NAMES[p]), "page compression and description");
    uint32_t *raster = _TIFFmalloc(W * H * sizeof(uint32_t));
    CHECK(raster && TIFFReadRGBAImageOriented(t, W, H, raster, ORIENTATION_TOPLEFT, 0), "TIFFReadRGBAImageOriented");
    int worst = 0;
    for (int y = 0; y < H; y++)
      for (int x = 0; x < W; x++) {
        uint32_t v = raster[y * W + x];
        int got[3] = {TIFFGetR(v), TIFFGetG(v), TIFFGetB(v)};
        for (int c = 0; c < 3; c++) {
          int d = abs(got[c] - px(x, y, c));
          if (d > worst) worst = d;
        }
      }
    _TIFFfree(raster);
    printf("%s max diff %d\n", NAMES[p], worst);
    CHECK(comp == COMPRESSION_JPEG ? worst <= 24 : worst == 0, "pixels after decode");
  }
  TIFFClose(t);
  const char *v = TIFFGetVersion();
  printf("%.*s\n", (int)strcspn(v, "\n"), v);
  printf("zlib %s\n", zlibVersion());
  printf("libjpeg %d\n", JPEG_LIB_VERSION);
  printf("probe ok\n");
  return 0;
}
