#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static const char *en(int e) {
  switch (e) {
    case ENOENT: return "ENOENT";
    case ENOTDIR: return "ENOTDIR";
    case EBADF: return "EBADF";
    case EACCES: return "EACCES";
    default: return strerror(e);
  }
}

static void rc(const char *what, int r) {
  if (r < 0) printf("%s: %s\n", what, en(errno));
  else printf("%s: 0\n", what);
}

static void cwd(const char *what) {
  char b[PATH_MAX];
  if (getcwd(b, sizeof b)) printf("%s: %s\n", what, b);
  else printf("%s: %s\n", what, en(errno));
}

static void opened(const char *what, int fd) {
  if (fd < 0) { printf("%s: %s\n", what, en(errno)); return; }
  char b[16] = "";
  ssize_t k = read(fd, b, sizeof b - 1);
  if (k > 0) b[k] = 0;
  close(fd);
  printf("%s: 0 %s\n", what, b);
}

static void make(const char *path, const char *text) {
  int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd >= 0) { write(fd, text, strlen(text)); close(fd); }
}

static void rows(const char *tag) {
  char w[96];
  struct stat st;
  snprintf(w, sizeof w, "%s: open real/f", tag);
  opened(w, open("real/f", O_RDONLY));
  snprintf(w, sizeof w, "%s: open ./real/f", tag);
  opened(w, open("./real/f", O_RDONLY));
  snprintf(w, sizeof w, "%s: openat AT_FDCWD real/f", tag);
  opened(w, openat(AT_FDCWD, "real/f", O_RDONLY));
  snprintf(w, sizeof w, "%s: stat real/f", tag);
  rc(w, stat("real/f", &st));
  snprintf(w, sizeof w, "%s: fstatat AT_FDCWD real/f", tag);
  rc(w, fstatat(AT_FDCWD, "real/f", &st, 0));
  snprintf(w, sizeof w, "%s: access real/f", tag);
  rc(w, access("real/f", R_OK));
  snprintf(w, sizeof w, "%s: open /tmp/r43/real/f", tag);
  opened(w, open("/tmp/r43/real/f", O_RDONLY));
  snprintf(w, sizeof w, "%s: create real/g", tag);
  make("real/g", tag);
  opened(w, open("/tmp/r43/real/g", O_RDONLY));
  unlink("/tmp/r43/real/g");
  char *rp = realpath("real/f", NULL);
  printf("%s: realpath real/f: %s\n", tag, rp ? rp : en(errno));
  free(rp);
  snprintf(w, sizeof w, "%s: chdir real", tag);
  rc(w, chdir("real"));
  snprintf(w, sizeof w, "%s: getcwd", tag);
  cwd(w);
  snprintf(w, sizeof w, "%s: open f", tag);
  opened(w, open("f", O_RDONLY));
  snprintf(w, sizeof w, "%s: chdir ..", tag);
  rc(w, chdir(".."));
  snprintf(w, sizeof w, "%s: getcwd", tag);
  cwd(w);
  snprintf(w, sizeof w, "%s: open real/f again", tag);
  opened(w, open("real/f", O_RDONLY));
}

int main(int argc, char **argv) {
  if (argc > 1) {
    int fd = open("/tmp/r43/other", O_RDONLY);
    rc("fresh: dup2 file 3", dup2(fd, 3));
    close(fd);
    rows("fresh");
    printf("r43 fresh done\n");
    return 0;
  }
  mkdir("/tmp/r43", 0755);
  mkdir("/tmp/r43/real", 0755);
  make("/tmp/r43/real/f", "abc");
  make("/tmp/r43/other", "xyz");
  rc("chdir /tmp/r43", chdir("/tmp/r43"));
  rows("fd 3 cwd");
  int fd = open("/tmp/r43/other", O_RDONLY);
  rc("dup2 file 3", dup2(fd, 3));
  close(fd);
  rows("dup2");
  char b[4] = "";
  printf("dup2: fd 3 reads: %s\n", pread(3, b, 3, 0) == 3 ? b : en(errno));
  rc("close 3", close(3));
  rows("closed");
  fd = open("/tmp/r43/other", O_RDONLY);
  printf("reopen: fd %d\n", fd);
  rows("reused");
  close(fd);
  printf("r43 done\n");
  return 0;
}
