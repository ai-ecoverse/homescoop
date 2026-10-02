/* Emscripten musl omits some legacy/shadow symbols screen references. */
#include <errno.h>
#include <limits.h>
#include <unistd.h>

struct spwd; /* opaque; screen only needs a NULL return */

int getdtablesize(void) {
  long n = sysconf(_SC_OPEN_MAX);
  if (n > 0 && n < INT_MAX)
    return (int)n;
  return 1024;
}

struct spwd *getspnam(const char *name) {
  (void)name;
  errno = ENOENT;
  return 0;
}
