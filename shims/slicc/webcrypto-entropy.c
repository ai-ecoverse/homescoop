#include <emscripten.h>
#include <stddef.h>

EM_JS(int, slicc_webcrypto_random, (unsigned char *out, size_t len), {
  for (let at = 0; at < len; at += 65536) {
    const n = Math.min(65536, len - at);
    globalThis.crypto.getRandomValues(HEAPU8.subarray(out + at, out + at + n));
  }
  return 0;
});

int mbedtls_hardware_poll(void *data, unsigned char *out, size_t len, size_t *olen) {
  (void)data;
  int ret = slicc_webcrypto_random(out, len);
  *olen = ret == 0 ? len : 0;
  return ret;
}
