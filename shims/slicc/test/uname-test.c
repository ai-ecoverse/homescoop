#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/utsname.h>

int main(void) {
  struct utsname u;
  memset(&u, 'x', sizeof u);
  if (uname(&u) != 0) {
    perror("uname");
    return 1;
  }
  printf("%s|%s|%s|%s|%s\n", u.sysname, u.nodename, u.release, u.version, u.machine);
  errno = 0;
  int r = uname(NULL);
  printf("null %d %s\n", r, errno == EFAULT ? "EFAULT" : strerror(errno));
  return 0;
}
