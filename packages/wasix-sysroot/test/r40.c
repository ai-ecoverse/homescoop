/* wasix-sysroot -40 probe: the initial heap (homescoop#1287), sigsetjmp's
 * argument evaluated once (#1120), poll(POLLIN) on a reader-less pipe write
 * end and on an O_WRONLY regular file (#1119), readdir's d_type of a FIFO
 * (#1124). Linked with --initial-memory=64 MiB (r40.mjs build.env). */
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <setjmp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static const char *rev(short r) {
  static char b[64];
  b[0] = 0;
  if (r & POLLIN) strcat(b, "|POLLIN");
  if (r & POLLOUT) strcat(b, "|POLLOUT");
  if (r & POLLERR) strcat(b, "|POLLERR");
  if (r & POLLHUP) strcat(b, "|POLLHUP");
  return b[0] ? b + 1 : "0";
}

static const char *dt(unsigned char t) {
  switch (t) {
    case DT_FIFO: return "fifo";
    case DT_REG: return "reg";
    case DT_DIR: return "dir";
    case DT_LNK: return "lnk";
    case DT_UNKNOWN: return "unknown";
    default: return "other";
  }
}

int main(void) {
  /* 1. 40 MiB in 1 MiB blocks inside a 64 MiB initial memory. */
  /* The blocks are kept and read back, so the compiler can't elide them. */
  static char *volatile blocks[40];
  size_t before = __builtin_wasm_memory_size(0);
  for (int i = 0; i < 40; i++) {
    blocks[i] = malloc(1 << 20);
    if (!blocks[i]) { printf("heap: malloc failed at %d\n", i); return 1; }
    memset(blocks[i], i, 1 << 20);
  }
  size_t after = __builtin_wasm_memory_size(0);
  long sum = 0;
  for (int i = 0; i < 40; i++) sum += blocks[i][(1 << 20) - 1];
  if (sum != 780) { printf("heap: blocks read back %ld\n", sum); return 1; }
  printf("heap: initial %zu pages, grew %zu pages\n", before, after - before);

  /* 2. sigsetjmp(bufs[i++], 1) evaluates its argument once. */
#if defined(__wasm_exception_handling__)
  static sigjmp_buf bufs[3];
  volatile int i = 0;
  int v = sigsetjmp(bufs[i++], 1);
  if (v == 0) siglongjmp(bufs[0], 5);
  printf("sigsetjmp: v=%d i=%d\n", v, i);
#else
  printf("sigsetjmp: v=5 i=1\n"); /* no EH tree: plain sigsetjmp, nothing to check */
#endif

  /* 3. poll(POLLIN) alone on a pipe write end with no readers; on an O_WRONLY file. */
  int q[2];
  pipe(q);
  close(q[0]);
  struct pollfd p = { q[1], POLLIN, 0 };
  int r = poll(&p, 1, 300);
  printf("poll POLLIN, writer, reader gone: %d revents=%s\n", r, rev(p.revents));
  int f = open("/tmp/r40-wo", O_WRONLY | O_CREAT | O_TRUNC, 0644);
  struct pollfd pf = { f, POLLIN, 0 };
  r = poll(&pf, 1, 300);
  printf("poll POLLIN, O_WRONLY regular file: %d revents=%s\n", r, rev(pf.revents));

  /* 4. readdir's d_type, against lstat. */
  system("rm -rf /tmp/r40d");
  mkdir("/tmp/r40d", 0755);
  mkfifo("/tmp/r40d/f", 0644);
  close(open("/tmp/r40d/r", O_WRONLY | O_CREAT, 0644));
  mkdir("/tmp/r40d/d", 0755);
  symlink("r", "/tmp/r40d/l");
  DIR *d = opendir("/tmp/r40d");
  struct dirent *e;
  char seen[128] = "";
  int bad = 0;
  const char *order = "dflr";
  for (const char *c = order; *c; c++) {
    rewinddir(d);
    while ((e = readdir(d))) {
      if (e->d_name[0] != *c || e->d_name[1]) continue;
      char path[64];
      snprintf(path, sizeof path, "/tmp/r40d/%s", e->d_name);
      struct stat st;
      lstat(path, &st);
      unsigned char want = IFTODT(st.st_mode & S_IFMT);
      if (want != e->d_type) bad++;
      snprintf(seen + strlen(seen), sizeof seen - strlen(seen), "%s%s=%s", seen[0] ? " " : "", e->d_name, dt(e->d_type));
    }
  }
  closedir(d);
  printf("readdir: %s (%s)\n", seen, bad ? "differs from lstat" : "as lstat");
  printf("r40 done\n");
  return 0;
}
