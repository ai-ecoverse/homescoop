#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

static char bufs[8][64];
static unsigned nb;

static const char *res(int r) {
  char *b = bufs[nb++ % 8];
  if (r < 0) snprintf(b, 64, "-1 %s", strerror(errno));
  else snprintf(b, 64, "%d", r);
  return b;
}

static int lk(int fd, int cmd, short type, off_t start, off_t len) {
  struct flock f = {.l_type = type, .l_whence = SEEK_SET, .l_start = start, .l_len = len};
  return fcntl(fd, cmd, &f);
}

int main(void) {
  setvbuf(stdout, NULL, _IONBF, 0);
  int fd = open("/tmp/r30lock", O_RDWR | O_CREAT | O_TRUNC, 0644);
  write(fd, "0123456789", 10);
  printf("setlk wr: %s\n", res(lk(fd, F_SETLK, F_WRLCK, 0, 5)));
  printf("bad type: %s\n", res(lk(fd, F_SETLK, 7, 0, 5)));
  printf("closed fd: %s\n", res(lk(99, F_SETLK, F_WRLCK, 0, 5)));
  pid_t me = getpid();
  pid_t p = fork();
  if (p == 0) {
    int cfd = open("/tmp/r30lock", O_RDWR);
    printf("child setlk wr: %s\n", res(lk(cfd, F_SETLK, F_WRLCK, 0, 1)));
    printf("child setlk other range: %s\n", res(lk(cfd, F_SETLK, F_WRLCK, 6, 2)));
    struct flock g = {.l_type = F_WRLCK, .l_whence = SEEK_SET, .l_start = 2, .l_len = 1};
    int r = fcntl(cfd, F_GETLK, &g);
    printf("child getlk: %s type=%d start=%lld len=%lld holder=%s\n", res(r), g.l_type, (long long)g.l_start, (long long)g.l_len, g.l_type == F_UNLCK ? "-" : g.l_pid == me ? "parent" : "other");
    printf("child lockf test: %s\n", res(lockf(cfd, F_TEST, 0)));
    // F_SETLKW must not return before the parent's unlock: the parent marks
    // byte 9 just before it unlocks, so the child sees 'U' only if it waited
    // (homescoop#526: a check that doesn't depend on whose line prints first).
    const char *w = res(lk(cfd, F_SETLKW, F_WRLCK, 0, 1));
    char mark = 0;
    pread(cfd, &mark, 1, 9);
    printf("child setlkw: %s after unlock: %s\n", w, mark == 'U' ? "yes" : "no");
    _exit(0);
  }
  usleep(500000);
  pwrite(fd, "U", 1, 9);
  const char *unlocked = res(lk(fd, F_SETLK, F_UNLCK, 0, 5));
  int st = 0;
  waitpid(p, &st, 0);
  printf("parent unlock: %s\n", unlocked);
  printf("child exit %d\n", WIFEXITED(st) ? WEXITSTATUS(st) : -1);
  printf("lockf tlock: %s\n", res(lockf(fd, F_TLOCK, 0)));
  printf("lockf ulock: %s\n", res(lockf(fd, F_ULOCK, 0)));
  printf("r30lock done\n");
  return 0;
}
