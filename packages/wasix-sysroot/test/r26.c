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

#ifndef AT_EMPTY_PATH
#define AT_EMPTY_PATH 0x1000
#endif

static const char *err(int r) {
  if (r >= 0) return "0";
  switch (errno) {
  case ENOENT: return "ENOENT";
  case EEXIST: return "EEXIST";
  case EISDIR: return "EISDIR";
  case ENOTDIR: return "ENOTDIR";
  case EINVAL: return "EINVAL";
  default: return strerror(errno);
  }
}

static void show(const char *label, int r) {
  printf("%s: %s\n", label, err(r));
  errno = 0;
}

int main(void) {
  setvbuf(stdout, NULL, _IONBF, 0);
  mkdir("/tmp/r26", 0755);
  if (chdir("/tmp/r26")) { perror("chdir"); return 1; }
  close(open("f", O_CREAT | O_WRONLY, 0644));
  unlink("l");
  struct stat st;
  char buf[PATH_MAX];
  int fd = open("", O_RDONLY);
  show("open", fd);
  if (fd >= 0) close(fd);
  show("open creat", open("", O_CREAT | O_WRONLY, 0644));
  show("stat", stat("", &st));
  show("lstat", lstat("", &st));
  show("access", access("", F_OK));
  show("mkdir", mkdir("", 0755));
  show("rmdir", rmdir(""));
  show("unlink", unlink(""));
  show("chmod", chmod("", 0644));
  show("chown", chown("", (uid_t)-1, (gid_t)-1));
  show("truncate", truncate("", 0));
  show("rename from", rename("", "x"));
  show("rename to", rename("f", ""));
  show("link", link("f", ""));
  show("symlink target", symlink("", "l"));
  show("symlink path", symlink("f", ""));
  show("readlink", (int)readlink("", buf, sizeof buf));
  show("chdir", chdir(""));
  errno = 0;
  DIR *d = opendir("");
  show("opendir", d ? 0 : -1);
  if (d) closedir(d);
  errno = 0;
  show("realpath", realpath("", buf) ? 0 : -1);
  int dfd = open(".", O_RDONLY | O_DIRECTORY);
  show("fstatat dirfd", fstatat(dfd, "", &st, 0));
  show("openat dirfd", openat(dfd, "", O_RDONLY));
  show("mkdirat dirfd", mkdirat(dfd, "", 0755));
  struct stat a, b;
  int r1 = fstatat(dfd, "", &a, AT_EMPTY_PATH);
  fstat(dfd, &b);
  printf("fstatat AT_EMPTY_PATH: %s same=%d\n", err(r1), r1 == 0 && a.st_ino == b.st_ino);
  errno = 0;
  int r2 = fstatat(AT_FDCWD, "", &a, AT_EMPTY_PATH);
  stat(".", &b);
  printf("fstatat cwd AT_EMPTY_PATH: %s same=%d\n", err(r2), r2 == 0 && a.st_ino == b.st_ino);
  errno = 0;
  show("stat .", stat(".", &st));
  show("stat /", stat("/", &st));
  show("access /", access("/", F_OK));
  fd = open(".", O_RDONLY | O_DIRECTORY);
  show("open .", fd);
  if (fd >= 0) close(fd);
  d = opendir(".");
  show("opendir .", d ? 0 : -1);
  if (d) closedir(d);
  show("stat f", stat("f", &st));
  show("realpath .", realpath(".", buf) ? 0 : -1);
  printf("cwd: %s\n", getcwd(buf, sizeof buf) ? buf : "?");
  close(dfd);
  printf("r26 done\n");
  return 0;
}
