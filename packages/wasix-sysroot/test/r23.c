#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>

static const char *err(int r) {
  if (r == 0) return "ok";
  if (errno == ENOTTY) return "ENOTTY";
  if (errno == EINVAL) return "EINVAL";
  if (errno == EBADF) return "EBADF";
  return strerror(errno);
}

static void probe(const char *label, int fd) {
  static const struct { const char *name; int get; int set; } nums[] = {
    {"wasix", 0x101, 0x102},
    {"linux", 0x5413, 0x5414},
  };
  for (unsigned i = 0; i < sizeof nums / sizeof nums[0]; i++) {
    struct winsize ws;
    memset(&ws, 0, sizeof ws);
    errno = 0;
    int g = ioctl(fd, nums[i].get, &ws);
    const char *eg = err(g);
    struct winsize want = {ws.ws_row, ws.ws_col, 0, 0};
    errno = 0;
    int s = ioctl(fd, nums[i].set, &want);
    const char *es = err(s);
    printf("%s %s: get=%s %dx%d set=%s\n", label, nums[i].name, eg, ws.ws_col, ws.ws_row, es);
  }
}

int main(int argc, char **argv) {
  setvbuf(stdout, NULL, _IONBF, 0);
  printf("headers: TIOCGWINSZ=0x%x TIOCSWINSZ=0x%x\n", TIOCGWINSZ, TIOCSWINSZ);
  if (argc > 1 && !strcmp(argv[1], "pipes")) {
    probe("stdin pipe", 0);
    probe("stdout pipe", 1);
    int f = open("/tmp/r23-file", O_CREAT | O_RDWR | O_TRUNC, 0644);
    probe("file", f);
    close(f);
    probe("closed", f);
    printf("r23 pipes done\n");
    return 0;
  }
  probe("tty", 0);
  probe("tty out", 1);
  printf("r23 tty done\n");
  return 0;
}
