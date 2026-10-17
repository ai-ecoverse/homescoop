#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <webp/decode.h>
#include <webp/encode.h>
#include <webp/mux.h>

#define W 64
#define H 48

static int failures = 0;

static void fail(const char *what) {
  printf("FAIL %s\n", what);
  failures++;
}

static int has_chunk(const uint8_t *data, size_t size, const char *fourcc) {
  for (size_t i = 12; i + 4 <= size; i++) {
    if (memcmp(data + i, fourcc, 4) == 0) return 1;
  }
  return 0;
}

static void check(const char *name, const uint8_t *data, size_t size, const uint8_t *src,
                  const char *chunk, int max_rgb, double max_mean_rgb) {
  char msg[256];
  if (size < 12 || memcmp(data, "RIFF", 4) != 0 || memcmp(data + 8, "WEBP", 4) != 0) {
    snprintf(msg, sizeof msg, "%s: not a RIFF/WEBP bitstream (%zu bytes)", name, size);
    fail(msg);
    return;
  }
  if (!has_chunk(data, size, chunk)) {
    snprintf(msg, sizeof msg, "%s: no %s chunk", name, chunk);
    fail(msg);
  }
  int w = 0, h = 0;
  if (!WebPGetInfo(data, size, &w, &h) || w != W || h != H) {
    snprintf(msg, sizeof msg, "%s: WebPGetInfo %dx%d, want %dx%d", name, w, h, W, H);
    fail(msg);
  }
  int dw = 0, dh = 0;
  uint8_t *out = WebPDecodeRGBA(data, size, &dw, &dh);
  if (!out) {
    snprintf(msg, sizeof msg, "%s: WebPDecodeRGBA failed", name);
    fail(msg);
    return;
  }
  if (dw != W || dh != H) {
    snprintf(msg, sizeof msg, "%s: decoded %dx%d, want %dx%d", name, dw, dh, W, H);
    fail(msg);
    WebPFree(out);
    return;
  }
  int max_d = 0, max_a = 0;
  long sum = 0;
  for (int i = 0; i < W * H; i++) {
    for (int c = 0; c < 3; c++) {
      int d = abs((int)out[i * 4 + c] - (int)src[i * 4 + c]);
      if (d > max_d) max_d = d;
      sum += d;
    }
    int da = abs((int)out[i * 4 + 3] - (int)src[i * 4 + 3]);
    if (da > max_a) max_a = da;
  }
  double mean = (double)sum / (W * H * 3);
  printf("%s: %zu bytes, %dx%d, rgb max diff %d, mean %.3f, alpha max diff %d\n", name, size,
         dw, dh, max_d, mean, max_a);
  if (max_d > max_rgb || mean > max_mean_rgb) {
    snprintf(msg, sizeof msg, "%s: rgb diff max %d (limit %d) mean %.3f (limit %.3f)", name,
             max_d, max_rgb, mean, max_mean_rgb);
    fail(msg);
  }
  if (max_a != 0) {
    snprintf(msg, sizeof msg, "%s: alpha diff max %d (want 0)", name, max_a);
    fail(msg);
  }
  WebPFree(out);
}

int main(void) {
  static uint8_t src[W * H * 4], tex[W * H * 4];
  uint32_t seed = 12345;
  for (int y = 0; y < H; y++) {
    for (int x = 0; x < W; x++) {
      uint8_t *p = src + (y * W + x) * 4;
      p[0] = (uint8_t)(x * 255 / (W - 1));
      p[1] = (uint8_t)((x + y) * 255 / (W + H - 2));
      p[2] = (uint8_t)(y * 255 / (H - 1));
      p[3] = (uint8_t)(128 + x * 127 / (W - 1));
      uint8_t *t = tex + (y * W + x) * 4;
      seed = seed * 1103515245u + 12345u;
      int g = 32 + (int)((seed >> 16) % 160);
      t[0] = (uint8_t)(g + x);
      t[1] = (uint8_t)g;
      t[2] = (uint8_t)(g + y);
      t[3] = p[3];
    }
  }
  int enc = WebPGetEncoderVersion(), dec = WebPGetDecoderVersion();
  printf("libwebp encoder %d.%d.%d decoder %d.%d.%d\n", enc >> 16, (enc >> 8) & 0xff,
         enc & 0xff, dec >> 16, (dec >> 8) & 0xff, dec & 0xff);
  if (enc != dec) fail("encoder and decoder versions differ");

  uint8_t *ll = NULL;
  size_t ll_size = WebPEncodeLosslessRGBA(tex, W, H, W * 4, &ll);
  if (!ll_size) {
    fail("lossless: WebPEncodeLosslessRGBA returned 0");
  } else {
    check("lossless", ll, ll_size, tex, "VP8L", 0, 0.0);
    WebPFree(ll);
  }

  uint8_t *ly = NULL;
  size_t ly_size = WebPEncodeRGBA(src, W, H, W * 4, 90.0f, &ly);
  if (!ly_size) {
    fail("lossy: WebPEncodeRGBA returned 0");
  } else {
    check("lossy", ly, ly_size, src, "VP8 ", 48, 4.0);
    if (!has_chunk(ly, ly_size, "ALPH")) fail("lossy: no ALPH chunk for the alpha ramp");
    WebPFree(ly);
  }

  WebPConfig cfg;
  WebPPicture pic;
  WebPMemoryWriter wr;
  if (!WebPConfigInit(&cfg) || !WebPPictureInit(&pic)) fail("sharp: WebPConfigInit / WebPPictureInit");
  cfg.quality = 90;
  cfg.use_sharp_yuv = 1;
  pic.width = W;
  pic.height = H;
  WebPMemoryWriterInit(&wr);
  pic.writer = WebPMemoryWrite;
  pic.custom_ptr = &wr;
  if (!WebPPictureImportRGBA(&pic, src, W * 4) || !WebPEncode(&cfg, &pic)) {
    fail("sharp: WebPEncode with use_sharp_yuv");
  } else {
    check("sharp-yuv", wr.mem, wr.size, src, "VP8 ", 48, 4.0);
    static const uint8_t exif[] = "Exif\0\0homescoop libwebp probe";
    WebPData image = {wr.mem, wr.size}, meta = {exif, sizeof exif}, out = {NULL, 0};
    WebPMux *mux = WebPMuxNew();
    if (!mux || WebPMuxSetImage(mux, &image, 1) != WEBP_MUX_OK || WebPMuxSetChunk(mux, "EXIF", &meta, 1) != WEBP_MUX_OK ||
        WebPMuxAssemble(mux, &out) != WEBP_MUX_OK) {
      fail("mux: assemble with an EXIF chunk");
    } else {
      FILE *f = fopen("probe.webp", "wb");
      if (!f || fwrite(out.bytes, 1, out.size, f) != out.size || fclose(f)) fail("mux: write probe.webp");
      WebPMux *back = WebPMuxCreate(&out, 1);
      WebPData got = {NULL, 0};
      if (!back || WebPMuxGetChunk(back, "EXIF", &got) != WEBP_MUX_OK || got.size != sizeof exif || memcmp(got.bytes, exif, sizeof exif))
        fail("mux: EXIF chunk read back");
      int dw = 0, dh = 0;
      uint8_t *px = WebPDecodeRGBA(out.bytes, out.size, &dw, &dh);
      if (!px || dw != W || dh != H) fail("mux: the assembled file decodes");
      WebPFree(px);
      WebPMuxDelete(back);
      printf("mux: %zu bytes with EXIF\n", out.size);
    }
    WebPDataClear(&out);
    WebPMuxDelete(mux);
  }
  WebPPictureFree(&pic);
  WebPMemoryWriterClear(&wr);

  if (failures) {
    printf("FAIL %d check(s)\n", failures);
    return 1;
  }
  printf("probe ok\n");
  return 0;
}
