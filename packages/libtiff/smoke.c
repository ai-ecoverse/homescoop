#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <tiffio.h>

int main(int argc, char **argv) {
  char path[512];
  snprintf(path, sizeof path, "%s/smoke.tif", argc > 1 ? argv[1] : "/tmp");
  TIFF *t = TIFFOpen(path, "w");
  if (!t) {
    fprintf(stderr, "TIFFOpen write failed: %s\n", path);
    return 1;
  }
  uint32_t w = 2, h = 2;
  unsigned char buf[12] = {255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255};
  TIFFSetField(t, TIFFTAG_IMAGEWIDTH, w);
  TIFFSetField(t, TIFFTAG_IMAGELENGTH, h);
  TIFFSetField(t, TIFFTAG_SAMPLESPERPIXEL, 3);
  TIFFSetField(t, TIFFTAG_BITSPERSAMPLE, 8);
  TIFFSetField(t, TIFFTAG_ORIENTATION, ORIENTATION_TOPLEFT);
  TIFFSetField(t, TIFFTAG_PLANARCONFIG, PLANARCONFIG_CONTIG);
  TIFFSetField(t, TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_RGB);
  TIFFSetField(t, TIFFTAG_COMPRESSION, COMPRESSION_NONE);
  TIFFSetField(t, TIFFTAG_ROWSPERSTRIP, h);
  if (TIFFWriteEncodedStrip(t, 0, buf, 12) < 0) {
    TIFFClose(t);
    return 2;
  }
  TIFFClose(t);
  t = TIFFOpen(path, "r");
  if (!t) return 3;
  uint32_t rw = 0, rh = 0;
  TIFFGetField(t, TIFFTAG_IMAGEWIDTH, &rw);
  TIFFGetField(t, TIFFTAG_IMAGELENGTH, &rh);
  TIFFClose(t);
  if (rw != 2 || rh != 2) return 4;
  printf("libtiff smoke: wrote+read %ux%u RGB TIFF\n", rw, rh);
  return 0;
}
