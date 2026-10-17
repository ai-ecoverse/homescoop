#include <png.h>
#include <setjmp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <zlib.h>

#define W 64
#define H 48
#define CHECK(c, m) do { if (!(c)) { printf("FAIL %s\n", m); return 1; } } while (0)

static unsigned char px(int x, int y, int c) {
  switch (c) {
    case 0: return (unsigned char)(x * 4);
    case 1: return (unsigned char)(y * 5);
    case 2: return (unsigned char)((x ^ y) * 3);
    default: return (unsigned char)(255 - x - y);
  }
}

int main(int argc, char **argv) {
  char path[512];
  snprintf(path, sizeof path, "%s/probe.png", argc > 1 ? argv[1] : ".");
  static unsigned char img[H][W * 4], back[H][W * 4];
  for (int y = 0; y < H; y++)
    for (int x = 0; x < W; x++)
      for (int c = 0; c < 4; c++) img[y][x * 4 + c] = px(x, y, c);

  FILE *fp = fopen(path, "wb");
  CHECK(fp, "fopen wb");
  png_structp png = png_create_write_struct(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL);
  png_infop info = png ? png_create_info_struct(png) : NULL;
  CHECK(png && info, "png_create_write_struct");
  if (setjmp(png_jmpbuf(png))) { printf("FAIL png write longjmp\n"); return 1; }
  png_init_io(png, fp);
  png_set_compression_level(png, 9);
  png_set_IHDR(png, info, W, H, 8, PNG_COLOR_TYPE_RGBA, PNG_INTERLACE_NONE, PNG_COMPRESSION_TYPE_DEFAULT, PNG_FILTER_TYPE_DEFAULT);
  png_text text;
  memset(&text, 0, sizeof text);
  text.compression = PNG_TEXT_COMPRESSION_zTXt;
  text.key = "Comment";
  text.text = "homescoop libpng probe";
  png_set_text(png, info, &text, 1);
  png_write_info(png, info);
  png_bytep rows[H];
  for (int y = 0; y < H; y++) rows[y] = img[y];
  png_write_image(png, rows);
  png_write_end(png, NULL);
  png_destroy_write_struct(&png, &info);
  fclose(fp);

  fp = fopen(path, "rb");
  CHECK(fp, "fopen rb");
  unsigned char sig[8];
  CHECK(fread(sig, 1, 8, fp) == 8 && !png_sig_cmp(sig, 0, 8), "png signature");
  png = png_create_read_struct(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL);
  info = png ? png_create_info_struct(png) : NULL;
  CHECK(png && info, "png_create_read_struct");
  if (setjmp(png_jmpbuf(png))) { printf("FAIL png read longjmp\n"); return 1; }
  png_init_io(png, fp);
  png_set_sig_bytes(png, 8);
  png_read_info(png, info);
  CHECK(png_get_image_width(png, info) == W && png_get_image_height(png, info) == H, "IHDR size");
  CHECK(png_get_color_type(png, info) == PNG_COLOR_TYPE_RGBA && png_get_bit_depth(png, info) == 8, "IHDR type");
  png_textp got = NULL;
  int n = 0;
  png_get_text(png, info, &got, &n);
  CHECK(n == 1 && !strcmp(got[0].key, "Comment") && !strcmp(got[0].text, "homescoop libpng probe"), "zTXt round trip");
  for (int y = 0; y < H; y++) rows[y] = back[y];
  png_read_image(png, rows);
  png_read_end(png, NULL);
  png_destroy_read_struct(&png, &info, NULL);
  fclose(fp);
  CHECK(!memcmp(img, back, sizeof img), "pixels round trip");

  png_image simple;
  memset(&simple, 0, sizeof simple);
  simple.version = PNG_IMAGE_VERSION;
  CHECK(png_image_begin_read_from_file(&simple, path), "png_image_begin_read_from_file");
  simple.format = PNG_FORMAT_GRAY;
  unsigned char *gray = malloc(PNG_IMAGE_SIZE(simple));
  CHECK(gray && png_image_finish_read(&simple, NULL, gray, 0, NULL), "png_image_finish_read gray");
  CHECK(simple.width == W && simple.height == H, "png_image size");
  free(gray);

  printf("libpng %s\n", png_get_libpng_ver(NULL));
  printf("zlib %s\n", zlibVersion());
  printf("probe ok\n");
  return 0;
}
