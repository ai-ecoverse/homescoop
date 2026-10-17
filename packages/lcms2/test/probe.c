#include <lcms2.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#define CHECK(c, m) do { if (!(c)) { printf("FAIL %s\n", m); return 1; } } while (0)

int main(void) {
  cmsHPROFILE srgb = cmsCreate_sRGBProfile();
  cmsHPROFILE xyz = cmsCreateXYZProfile();
  cmsHPROFILE lab = cmsCreateLab4Profile(NULL);
  CHECK(srgb && xyz && lab, "built-in profiles");

  cmsHTRANSFORM toXYZ = cmsCreateTransform(srgb, TYPE_RGB_8, xyz, TYPE_XYZ_DBL, INTENT_RELATIVE_COLORIMETRIC, 0);
  CHECK(toXYZ, "sRGB -> XYZ transform");
  unsigned char red[3] = {255, 0, 0};
  cmsCIEXYZ r;
  cmsDoTransform(toXYZ, red, &r, 1);
  printf("red XYZ %.6f %.6f %.6f\n", r.X, r.Y, r.Z);
  CHECK(fabs(r.X - 0.436065) < 1e-3 && fabs(r.Y - 0.222493) < 1e-3 && fabs(r.Z - 0.013627) < 1e-3, "sRGB red in D50 XYZ");
  cmsDeleteTransform(toXYZ);

  cmsHTRANSFORM toLab = cmsCreateTransform(srgb, TYPE_RGB_8, lab, TYPE_Lab_DBL, INTENT_PERCEPTUAL, 0);
  cmsHTRANSFORM fromLab = cmsCreateTransform(lab, TYPE_Lab_DBL, srgb, TYPE_RGB_8, INTENT_PERCEPTUAL, 0);
  CHECK(toLab && fromLab, "sRGB <-> Lab transforms");
  unsigned char white[3] = {255, 255, 255};
  cmsCIELab w;
  cmsDoTransform(toLab, white, &w, 1);
  printf("white Lab %.4f %.4f %.4f\n", w.L, w.a, w.b);
  CHECK(fabs(w.L - 100) < 0.01 && fabs(w.a) < 0.01 && fabs(w.b) < 0.01, "white is L 100");
  unsigned char samples[][3] = {{12, 200, 99}, {250, 128, 3}, {7, 7, 7}, {130, 60, 220}};
  for (unsigned i = 0; i < sizeof samples / sizeof samples[0]; i++) {
    cmsCIELab l;
    unsigned char back[3];
    cmsDoTransform(toLab, samples[i], &l, 1);
    cmsDoTransform(fromLab, &l, back, 1);
    for (int c = 0; c < 3; c++) CHECK(abs(back[c] - samples[i][c]) <= 1, "sRGB -> Lab -> sRGB within 1");
  }
  cmsCIELab a = {50, 20, -30}, b = {52, 18, -27};
  double de = cmsDeltaE(&a, &b);
  printf("deltaE76 %.4f\n", de);
  CHECK(fabs(de - sqrt(4 + 4 + 9)) < 1e-9, "cmsDeltaE");
  cmsDeleteTransform(toLab);
  cmsDeleteTransform(fromLab);

  cmsUInt32Number len = 0;
  CHECK(cmsSaveProfileToMem(srgb, NULL, &len) && len > 128, "profile size");
  void *mem = malloc(len);
  CHECK(mem && cmsSaveProfileToMem(srgb, mem, &len), "cmsSaveProfileToMem");
  cmsHPROFILE again = cmsOpenProfileFromMem(mem, len);
  CHECK(again, "cmsOpenProfileFromMem");
  CHECK(cmsGetColorSpace(again) == cmsSigRgbData && cmsGetDeviceClass(again) == cmsSigDisplayClass && cmsGetPCS(again) == cmsSigXYZData, "saved profile header");
  FILE *f = fopen("probe.icc", "wb");
  CHECK(f && fwrite(mem, 1, len, f) == len && fclose(f) == 0, "write probe.icc");
  cmsCloseProfile(again);
  free(mem);
  cmsCloseProfile(srgb);
  cmsCloseProfile(xyz);
  cmsCloseProfile(lab);
  printf("lcms2 %d\n", cmsGetEncodedCMMversion());
  printf("probe ok\n");
  return 0;
}
