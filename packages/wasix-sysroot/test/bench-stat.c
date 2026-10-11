#include <dirent.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

static double now_ms(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec * 1e3 + t.tv_nsec / 1e6;
}

int main(int argc, char **argv) {
  if (argc < 3) return 2;
  const char *root = argv[1];
  int n = atoi(argv[2]);
  int dirs = n / 20 > 0 ? n / 20 : 1;
  char p[256];
  for (int d = 0; d < dirs; d++) {
    snprintf(p, sizeof p, "%s/d%d", root, d);
    mkdir(p, 0755);
  }
  for (int i = 0; i < n; i++) {
    snprintf(p, sizeof p, "%s/d%d/f%d", root, i % dirs, i);
    int fd = open(p, O_CREAT | O_WRONLY | O_TRUNC, 0644);
    if (fd < 0) { perror(p); return 1; }
    close(fd);
  }
  struct stat st;
  unsigned long sum = 0;
  double t = now_ms();
  for (int d = 0; d < dirs; d++) {
    snprintf(p, sizeof p, "%s/d%d", root, d);
    DIR *dp = opendir(p);
    if (!dp) { perror(p); return 1; }
    struct dirent *e;
    while ((e = readdir(dp))) {
      if (e->d_name[0] == '.') continue;
      char q[300];
      snprintf(q, sizeof q, "%s/%s", p, e->d_name);
      if (lstat(q, &st) == 0) sum += st.st_uid + st.st_size;
    }
    closedir(dp);
  }
  printf("walk-lstat %.1f\n", now_ms() - t);
  t = now_ms();
  for (int i = 0; i < n; i++) {
    snprintf(p, sizeof p, "%s/d%d/f%d", root, i % dirs, i);
    if (stat(p, &st) == 0) sum += st.st_gid;
  }
  printf("stat %.1f\n", now_ms() - t);
  snprintf(p, sizeof p, "%s/d0/f0", root);
  int fd = open(p, O_RDONLY);
  t = now_ms();
  for (int i = 0; i < n; i++)
    if (fstat(fd, &st) == 0) sum += st.st_mode;
  printf("fstat %.1f\n", now_ms() - t);
  close(fd);
  return sum == 42 ? 3 : 0;
}
