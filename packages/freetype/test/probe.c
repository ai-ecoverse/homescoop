#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_OUTLINE_H
#include FT_BBOX_H
#include <stdio.h>
#include <string.h>

#define CHECK(c, m) do { if (!(c)) { printf("FAIL %s\n", m); return 1; } } while (0)

int main(int argc, char **argv) {
  FT_Library lib;
  CHECK(!FT_Init_FreeType(&lib), "FT_Init_FreeType");
  FT_Int maj, min, pat;
  FT_Library_Version(lib, &maj, &min, &pat);
  FT_Face face;
  static const unsigned char junk[64] = "not a font at all";
  CHECK(FT_New_Memory_Face(lib, junk, sizeof junk, 0, &face) == FT_Err_Unknown_File_Format, "garbage is FT_Err_Unknown_File_Format");
  FT_Outline o;
  CHECK(!FT_Outline_New(lib, 8, 2, &o), "FT_Outline_New");
  FT_Vector pts[8] = {{2 * 64, 2 * 64}, {30 * 64, 2 * 64}, {30 * 64, 30 * 64}, {2 * 64, 30 * 64},
                      {10 * 64, 10 * 64}, {10 * 64, 22 * 64}, {22 * 64, 22 * 64}, {22 * 64, 10 * 64}};
  memcpy(o.points, pts, sizeof pts);
  memset(o.tags, FT_CURVE_TAG_ON, 8);
  o.contours[0] = 3;
  o.contours[1] = 7;
  o.n_points = 8;
  o.n_contours = 2;
  CHECK(!FT_Outline_Check(&o), "FT_Outline_Check");
  FT_BBox box;
  CHECK(!FT_Outline_Get_BBox(&o, &box) && box.xMin == 128 && box.yMax == 1920, "FT_Outline_Get_BBox");
  static unsigned char px[32 * 32];
  FT_Bitmap bm = {0};
  bm.rows = 32;
  bm.width = 32;
  bm.pitch = 32;
  bm.buffer = px;
  bm.num_grays = 256;
  bm.pixel_mode = FT_PIXEL_MODE_GRAY;
  CHECK(!FT_Outline_Get_Bitmap(lib, &o, &bm), "FT_Outline_Get_Bitmap");
  int full = 0, empty = 0;
  for (int i = 0; i < 32 * 32; i++) {
    if (px[i] == 255) full++;
    if (px[i] == 0) empty++;
  }
  printf("square ring: %d full, %d empty pixels\n", full, empty);
  CHECK(full == 28 * 28 - 12 * 12 && empty == 32 * 32 - (28 * 28 - 12 * 12), "the 28x28 square with a 12x12 hole fills exactly 640 pixels");
  CHECK(px[31 * 32 - 16 * 32 + 16] == 0 && px[(31 - 5) * 32 + 5] == 255, "the hole is empty and the ring is inked");
  char path[512];
  snprintf(path, sizeof path, "%s/probe.pgm", argc > 1 ? argv[1] : ".");
  FILE *f = fopen(path, "wb");
  CHECK(f && fprintf(f, "P5\n32 32\n255\n") > 0 && fwrite(px, 1, sizeof px, f) == sizeof px && !fclose(f), "write probe.pgm");
  FT_Outline_Done(lib, &o);
  FT_Done_FreeType(lib);
  printf("freetype %d.%d.%d\n", maj, min, pat);
  printf("probe ok\n");
  return 0;
}
