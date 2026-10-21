#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/utsname.h>
#include <unistd.h>

static void put(const char *text, size_t n) {
  int fd = open("/etc/hostname", O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd < 0) { printf("write /etc/hostname: %s\n", strerror(errno)); return; }
  if (n && write(fd, text, n) != (ssize_t)n) printf("write /etc/hostname: short\n");
  close(fd);
}

static void show(const char *what) {
  char h[256];
  struct utsname u;
  memset(h, 'x', sizeof h);
  errno = 4321;
  int r = gethostname(h, sizeof h);
  int e = errno;
  int ur = uname(&u);
  printf("%s: %d %s uname=%s%s\n", what, r, h, ur == 0 && !strcmp(u.nodename, h) ? "same" : u.nodename, e == 4321 ? "" : " errno-changed");
}

static void line(const char *what, const char *text) {
  put(text, strlen(text));
  show(what);
}

int main(void) {
  struct stat st;
  const char *env = getenv("HOSTNAME");
  char kernel[64];
  snprintf(kernel, sizeof kernel, "%s", env ? env : "");
  printf("start: HOSTNAME %s, /etc/hostname %s\n", env ? "set" : "unset", stat("/etc/hostname", &st) == 0 ? "present" : "absent");
  unsetenv("HOSTNAME");
  show("kernel file, no HOSTNAME");
  setenv("HOSTNAME", kernel, 1);
  mkdir("/etc", 0755);
  line("file", "  r42-file \t\r\nsecond\n");
  line("file without newline", "r42-nonl");
  line("file 64 chars", "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijkl\n");
  setenv("HOSTNAME", "r42-env", 1);
  line("empty file", "");
  line("blank line", "  \t\nr42-second\n");
  line("file 65 chars", "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklm\n");
  char big[400];
  memset(big, 'a', sizeof big - 1);
  big[sizeof big - 1] = 0;
  line("file 399 chars, no newline", big);
  line("file with a slash", "r42/x\n");
  line("file with a space inside", "r42 x\n");
  printf("unlink /etc/hostname: %d\n", unlink("/etc/hostname"));
  printf("after unlink: /etc/hostname %s\n", stat("/etc/hostname", &st) == 0 ? "present" : "absent");
  show("no file");
  setenv("HOSTNAME", "", 1);
  show("no file, empty HOSTNAME");
  unsetenv("HOSTNAME");
  show("no file, no HOSTNAME");
  put("", 0);
  show("empty file, no HOSTNAME");
  unlink("/etc/hostname");
  char small[4];
  setenv("HOSTNAME", "r42-env", 1);
  printf("gethostname 4 bytes: %d %s\n", gethostname(small, sizeof small), small);
  printf("r42 done\n");
  return 0;
}
