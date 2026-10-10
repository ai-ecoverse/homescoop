// Create micro-benchmark for the slicc_fs create path (homescoop#169):
// `bench-create <dir> <n>` times n × open(O_CREAT|O_TRUNC)+write+close for
// fresh files at 0644 (the kernel's own create mode under umask 022) and
// 0600 (needs fd_chmod), the same opens again on the existing files, and n
// mkdir 0700. Prints one "case ms" line per case.
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

static double now_ms(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec * 1e3 + t.tv_nsec / 1e6;
}

static int creates(const char *prefix, int n, mode_t mode) {
  char p[64];
  for (int i = 0; i < n; i++) {
    snprintf(p, sizeof p, "%s%d", prefix, i);
    int fd = open(p, O_CREAT | O_WRONLY | O_TRUNC, mode);
    if (fd < 0) { perror(p); return 1; }
    if (write(fd, "x\n", 2) != 2) { perror("write"); return 1; }
    close(fd);
  }
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 3 || chdir(argv[1]) != 0) { fprintf(stderr, "usage: bench-create <dir> <n>\n"); return 2; }
  int n = atoi(argv[2]);
  umask(022);
  double t = now_ms();
  if (creates("a", n, 0644)) return 1;
  printf("fresh-0644 %.1f\n", now_ms() - t);
  t = now_ms();
  if (creates("b", n, 0600)) return 1;
  printf("fresh-0600 %.1f\n", now_ms() - t);
  t = now_ms();
  if (creates("b", n, 0600)) return 1;
  printf("existing-0600 %.1f\n", now_ms() - t);
  t = now_ms();
  char p[64];
  for (int i = 0; i < n; i++) {
    snprintf(p, sizeof p, "d%d", i);
    if (mkdir(p, 0700) != 0) { perror(p); return 1; }
  }
  printf("mkdir-0700 %.1f\n", now_ms() - t);
  return 0;
}
