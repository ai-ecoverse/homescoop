#include <lcms2.h>
#include <stdio.h>

int main(void) {
  cmsHPROFILE in = cmsCreate_sRGBProfile();
  cmsHPROFILE out = cmsCreateXYZProfile();
  if (!in || !out) return 1;
  cmsHTRANSFORM xform = cmsCreateTransform(
      in, TYPE_RGB_8, out, TYPE_XYZ_DBL, INTENT_PERCEPTUAL, 0);
  if (!xform) return 2;
  unsigned char rgb[3] = {255, 0, 0};
  double xyz[3] = {0, 0, 0};
  cmsDoTransform(xform, rgb, xyz, 1);
  cmsDeleteTransform(xform);
  cmsCloseProfile(in);
  cmsCloseProfile(out);
  if (xyz[0] <= 0) return 3;
  printf("lcms2 smoke: sRGB(255,0,0) -> XYZ %f %f %f\n", xyz[0], xyz[1], xyz[2]);
  return 0;
}
