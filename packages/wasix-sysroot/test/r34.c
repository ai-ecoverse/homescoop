/* wasix-sysroot -34 probe: mkfifo, mkfifoat, mknod, mknodat through
 * slicc_fs.path_mkfifo (homescoop#878, slicc-kernel#957, 1.120.0). */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

static char bufs[8][96];
static unsigned next_buf;
static const char *res(int r) {
  char *b = bufs[next_buf++ % 8];
  if (r < 0) snprintf(b, sizeof bufs[0], "-1 %s", strerror(errno));
  else snprintf(b, sizeof bufs[0], "%d", r);
  return b;
}

static const char *kind(const char *path) {
  struct stat st;
  char *b = bufs[next_buf++ % 8];
  if (lstat(path, &st) != 0) snprintf(b, sizeof bufs[0], "none");
  else snprintf(b, sizeof bufs[0], "%s %04o", S_ISFIFO(st.st_mode) ? "fifo" : S_ISREG(st.st_mode) ? "reg" : S_ISLNK(st.st_mode) ? "link" : "other", (unsigned)(st.st_mode & 07777));
  return b;
}

int main(void) {
  setvbuf(stdout, NULL, _IONBF, 0);
  mkdir("/tmp/r34", 0755);
  chdir("/tmp/r34");
  unlink("f1"); unlink("f2"); unlink("f3"); unlink("f4"); unlink("dang"); unlink("dev");
  umask(022);
  int r = mkfifo("f1", 0666);
  int e = errno;
  printf("mkfifo f1 0666 umask 022: %s %s\n", res(r), kind("f1"));
  if (r < 0 && e == ENOSYS) {
    printf("mknod S_IFIFO: %s\n", res(mknod("f3", S_IFIFO | 0600, 0)));
    printf("r34 done (no path_mkfifo)\n");
    return 0;
  }
  printf("mkfifo f1 again: %s\n", res(mkfifo("f1", 0600)));
  int d = open("/tmp/r34", O_RDONLY | O_DIRECTORY);
  printf("mkfifoat dirfd f2 0600: %s %s\n", res(mkfifoat(d, "f2", 0600)), kind("f2"));
  printf("mkfifoat AT_FDCWD /tmp/r34/f4: %s %s\n", res(mkfifoat(AT_FDCWD, "/tmp/r34/f4", 0640)), kind("f4"));
  printf("mknod S_IFIFO f3: %s %s\n", res(mknod("f3", S_IFIFO | 0600, 0)), kind("f3"));
  printf("mknod S_IFREG reg: %s %s\n", res(mknod("reg", S_IFREG | 0644, 0)), kind("reg"));
  printf("mknod S_IFCHR dev: %s %s\n", res(mknod("dev", S_IFCHR | 0600, 0)), kind("dev"));
  symlink("/tmp/r34/nowhere", "dang");
  printf("mkfifo over a dangling link: %s %s\n", res(mkfifo("dang", 0600)), kind("dang"));
  printf("mkfifo in a missing dir: %s\n", res(mkfifo("nodir/x", 0600)));
  pid_t c = fork();
  if (c == 0) {
    int w = open("f1", O_WRONLY);
    write(w, "hello", 5);
    close(w);
    _exit(0);
  }
  int rd = open("f1", O_RDONLY);
  char buf[16] = {0};
  int n = 0, k;
  while ((k = read(rd, buf + n, sizeof buf - 1 - n)) > 0) n += k;
  close(rd);
  int st = 0;
  waitpid(c, &st, 0);
  printf("writer and reader meet through f1: read=%d \"%s\" child=%d\n", n, buf, WEXITSTATUS(st));
  unlink("f1"); unlink("f2"); unlink("f3"); unlink("f4"); unlink("reg"); unlink("dang");
  printf("r34 done\n");
  return 0;
}
