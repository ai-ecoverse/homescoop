#include <png.h>
#include <setjmp.h>
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
  char path[512];
  snprintf(path, sizeof path, "%s/smoke.png", argc > 1 ? argv[1] : "/tmp");
  const int w = 2, h = 2;
  unsigned char src[16] = {
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255};

  FILE *fp = fopen(path, "wb");
  if (!fp) return 1;
  png_structp png = png_create_write_struct(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL);
  png_infop info = png ? png_create_info_struct(png) : NULL;
  if (!png || !info || setjmp(png_jmpbuf(png))) return 2;
  png_init_io(png, fp);
  png_set_IHDR(png, info, (png_uint_32)w, (png_uint_32)h, 8, PNG_COLOR_TYPE_RGBA,
               PNG_INTERLACE_NONE, PNG_COMPRESSION_TYPE_DEFAULT, PNG_FILTER_TYPE_DEFAULT);
  png_write_info(png, info);
  png_bytep rows[2] = {src, src + 8};
  png_write_image(png, rows);
  png_write_end(png, NULL);
  png_destroy_write_struct(&png, &info);
  fclose(fp);

  fp = fopen(path, "rb");
  if (!fp) return 3;
  png = png_create_read_struct(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL);
  info = png ? png_create_info_struct(png) : NULL;
  if (!png || !info || setjmp(png_jmpbuf(png))) return 4;
  png_init_io(png, fp);
  png_read_info(png, info);
  if (png_get_image_width(png, info) != 2 || png_get_image_height(png, info) != 2 ||
      png_get_color_type(png, info) != PNG_COLOR_TYPE_RGBA || png_get_bit_depth(png, info) != 8) {
    return 5;
  }
  unsigned char dst[16];
  png_bytep out_rows[2] = {dst, dst + 8};
  png_read_image(png, out_rows);
  png_read_end(png, NULL);
  png_destroy_read_struct(&png, &info, NULL);
  fclose(fp);
  if (memcmp(src, dst, 16) != 0) return 6;
  printf("libpng smoke: wrote+read 2x2 RGBA PNG\n");
  return 0;
}
