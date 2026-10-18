/* wasix-sysroot -37 probe: Linux's file-type bits (homescoop#1015) and
 * device modes (#1112). */
#include <fcntl.h>
#include <stdio.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

static const char *kind(mode_t m) {
  return S_ISFIFO(m) ? "fifo" : S_ISSOCK(m) ? "sock" : S_ISCHR(m) ? "chr" : S_ISBLK(m) ? "blk" : S_ISDIR(m) ? "dir" : S_ISLNK(m) ? "lnk" : S_ISREG(m) ? "reg" : "?";
}

static void show(const char *label, int r, const struct stat *st) {
  if (r) { printf("%s: stat failed\n", label); return; }
  printf("%s: %s type=%06o mode=%06o\n", label, kind(st->st_mode), (unsigned)(st->st_mode & S_IFMT), (unsigned)st->st_mode);
}

int main(void) {
  setvbuf(stdout, NULL, _IONBF, 0);
  printf("S_IFMT=%06o S_IFSOCK=%06o S_IFLNK=%06o S_IFREG=%06o S_IFBLK=%06o S_IFDIR=%06o S_IFCHR=%06o S_IFIFO=%06o\n",
         S_IFMT, S_IFSOCK, S_IFLNK, S_IFREG, S_IFBLK, S_IFDIR, S_IFCHR, S_IFIFO);
  struct stat st;
  int f = open("/tmp/r38f", O_CREAT | O_WRONLY | O_TRUNC, 0644); close(f);
  show("regular", stat("/tmp/r38f", &st), &st);
  mkdir("/tmp/r38d", 0755);
  show("directory", stat("/tmp/r38d", &st), &st);
  unlink("/tmp/r38l"); symlink("/tmp/r38f", "/tmp/r38l");
  show("symlink", lstat("/tmp/r38l", &st), &st);
  int p[2]; pipe(p);
  show("pipe", fstat(p[0], &st), &st);
  int sv[2]; socketpair(AF_UNIX, SOCK_STREAM, 0, sv);
  show("socket", fstat(sv[0], &st), &st);
  show("/dev/null", stat("/dev/null", &st), &st);
  show("/dev/zero", stat("/dev/zero", &st), &st);
  int n = open("/dev/null", O_RDONLY);
  show("fstat /dev/null", fstat(n, &st), &st);
  printf("r38 done\n");
  return 0;
}
