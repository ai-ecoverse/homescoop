/* WASIX libc gaps for MRI static link (asyncify sysroot). */
#include <errno.h>
#include <stddef.h>
#include <sys/types.h>

int madvise(void *addr, size_t length, int advice)
{
  (void)addr;
  (void)length;
  (void)advice;
  errno = ENOSYS;
  return -1;
}

/* OpenSSL dso_dlfcn; WASIX has no DSO map. */
struct Dl_info;
int dladdr(const void *addr, struct Dl_info *info)
{
  (void)addr;
  (void)info;
  return 0;
}
