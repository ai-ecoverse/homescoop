#define _GNU_SOURCE
#include <dirent.h>
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
    case EACCES: return "EACCES";
    case ENOMEM: return "ENOMEM";
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

static void entries(const char *what) {
  DIR *d = opendir(".");
  if (!d) { printf("%s: %s\n", what, en(errno)); return; }
  struct dirent *e;
  char names[256] = "";
  int n = 0;
  while ((e = readdir(d))) {
    if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
    n++;
    snprintf(names + strlen(names), sizeof names - strlen(names), " %s", e->d_name);
  }
  closedir(d);
  printf("%s: %d%s\n", what, n, names);
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

int main(void) {
  struct stat a, b;
  mkdir("/tmp/r41", 0755);
  rc("chdir /tmp/r41", chdir("/tmp/r41"));
  rc("mkdir d", mkdir("d", 0755));
  rc("chdir d", chdir("d"));
  cwd("getcwd");
  make("f", "abc");
  rc("stat f", stat("f", &a));
  int same = stat("/tmp/r41/d/f", &b) == 0 && a.st_ino == b.st_ino && a.st_size == 3;
  printf("stat f is /tmp/r41/d/f: %d\n", same);
  rc("fstatat AT_FDCWD f", fstatat(AT_FDCWD, "f", &b, 0));
  rc("access ./f", access("./f", R_OK));
  opened("openat AT_FDCWD ./f", openat(AT_FDCWD, "./f", O_RDONLY));
  rc("mkdir sub", mkdir("sub", 0755));
  rc("chdir sub", chdir("sub"));
  cwd("getcwd");
  rc("chdir ..", chdir(".."));
  cwd("getcwd");
  rc("chdir ./sub/../..", chdir("./sub/../.."));
  cwd("getcwd");
  char *rp = realpath("d/f", NULL);
  printf("realpath d/f: %s\n", rp ? rp : en(errno));
  free(rp);
  entries("readdir .");

  rc("chdir d", chdir("d"));
  unlink("/tmp/r41/d/f");
  rmdir("/tmp/r41/d/sub");
  rc("rmdir /tmp/r41/d", rmdir("/tmp/r41/d"));
  mkdir("/tmp/r41/n", 0755);
  make("/tmp/r41/n/x", "new");
  rc("rename n d", rename("/tmp/r41/n", "/tmp/r41/d"));
  entries("gone: readdir .");
  opened("gone: open x", open("x", O_RDONLY));
  rc("gone: stat x", stat("x", &a));
  rc("gone: fstatat AT_FDCWD x", fstatat(AT_FDCWD, "x", &a, 0));
  rc("gone: access x", access("x", F_OK));
  rc("gone: chdir x", chdir("x"));
  rc("gone: chdir .", chdir("."));
  rc("gone: chdir ./.", chdir("./."));
  opened("gone: open x after chdir .", open("x", O_RDONLY));
  cwd("gone: getcwd");
  rc("gone: chdir ..", chdir(".."));
  cwd("getcwd");
  opened("open d/x", open("d/x", O_RDONLY));

  rc("chdir d", chdir("d"));
  unlink("/tmp/r41/d/x");
  rc("rmdir /tmp/r41/d", rmdir("/tmp/r41/d"));
  mkdir("/tmp/r41/n", 0755);
  make("/tmp/r41/n/y", "two");
  rc("rename n d", rename("/tmp/r41/n", "/tmp/r41/d"));
  opened("gone2: open y", open("y", O_RDONLY));
  cwd("gone2: getcwd");
  rc("gone2: chdir ./..", chdir("./.."));
  cwd("getcwd");
  opened("open d/y", open("d/y", O_RDONLY));
  printf("r41 done\n");
  return 0;
}
