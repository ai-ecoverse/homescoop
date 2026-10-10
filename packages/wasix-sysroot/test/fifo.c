// wasix-sysroot 2025.9.30-21 probe: file types from fstat/stat/lstat. A
// pipe is S_IFIFO only when slicc-kernel's slicc_fs fd_mode reports it (WASI
// has no FIFO filetype); other types stay as before. Run with stdin a pipe.
#include <fcntl.h>
#include <stdio.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

static void show(const char *label, int r, const struct stat *st) {
  if (r != 0) { printf("%s: stat failed\n", label); return; }
  printf("%s: fifo=%d sock=%d reg=%d dir=%d lnk=%d chr=%d fmt=%o\n", label, S_ISFIFO(st->st_mode), S_ISSOCK(st->st_mode),
         S_ISREG(st->st_mode), S_ISDIR(st->st_mode), S_ISLNK(st->st_mode), S_ISCHR(st->st_mode), (unsigned)(st->st_mode & S_IFMT));
}

int main(void) {
  setvbuf(stdout, NULL, _IOLBF, 0);
  struct stat st;
  show("stdin pipe", fstat(0, &st), &st);
  int p[2];
  if (pipe(p) == 0) { show("pipe()", fstat(p[0], &st), &st); }
  int f = open("/tmp/fifo-probe", O_CREAT | O_WRONLY | O_TRUNC, 0644);
  show("file", fstat(f, &st), &st);
  close(f);
  show("stat file", stat("/tmp/fifo-probe", &st), &st);
  show("dir", stat("/tmp", &st), &st);
  unlink("/tmp/fifo-link");
  symlink("/tmp/fifo-probe", "/tmp/fifo-link");
  show("lstat link", lstat("/tmp/fifo-link", &st), &st);
  int n = open("/dev/null", O_RDONLY);
  show("dev null", fstat(n, &st), &st);
  int s = socket(AF_INET, SOCK_STREAM, 0);
  if (s >= 0) show("socket", fstat(s, &st), &st);
  else printf("socket: none\n");
  printf("fifo done\n");
  return 0;
}
