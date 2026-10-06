#include <stddef.h>
/* wasix-python exports mmap/munmap but not mprotect; harfbuzz may still
 * reference it via HAVE_MPROTECT. Provide a no-op that succeeds. */
int mprotect(void *addr, size_t len, int prot) {
  (void)addr; (void)len; (void)prot;
  return 0;
}
