// wasix-sysroot 2025.9.30-18 probe: select/pselect with exceptfds (#195),
// chdir across a symlink (#196), POSIX TZ rules (#193),
// socketpair with SOCK_NONBLOCK|SOCK_CLOEXEC (upstream 2025b44a5d).
// One line per result; test/r18.mjs checks them.
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

static void selects(void) {
  int p[2];
  if (pipe(p) != 0) { printf("pipe failed %d\n", errno); return; }
  if (write(p[1], "x", 1) != 1) { printf("write failed\n"); return; }
  fd_set r, e;
  FD_ZERO(&r); FD_ZERO(&e);
  FD_SET(p[0], &r); FD_SET(p[0], &e);
  struct timeval tv = {1, 0};
  errno = 0;
  int n = select(p[0] + 1, &r, NULL, &e, &tv);
  printf("select data: n=%d r=%d e=%d errno=%d\n", n, n >= 0 && FD_ISSET(p[0], &r), n >= 0 && FD_ISSET(p[0], &e), n < 0 ? errno : 0);

  char c;
  if (read(p[0], &c, 1) != 1) printf("read failed\n");
  FD_ZERO(&r); FD_ZERO(&e);
  FD_SET(p[0], &r); FD_SET(p[0], &e);
  struct timeval t2 = {0, 200000};
  struct timeval b2, a2;
  gettimeofday(&b2, NULL);
  errno = 0;
  n = select(p[0] + 1, &r, NULL, &e, &t2);
  gettimeofday(&a2, NULL);
  long w2 = (a2.tv_sec - b2.tv_sec) * 1000 + (a2.tv_usec - b2.tv_usec) / 1000;
  printf("select empty: n=%d errno=%d waited=%s\n", n, n < 0 ? errno : 0, w2 >= 150 ? "yes" : "no");

  // Only exceptional conditions, with a timeout: nothing, after the timeout.
  FD_ZERO(&e);
  FD_SET(p[0], &e);
  struct timespec ts = {0, 100000000};
  struct timeval before, after;
  gettimeofday(&before, NULL);
  errno = 0;
  n = pselect(p[0] + 1, NULL, NULL, &e, &ts, NULL);
  gettimeofday(&after, NULL);
  long ms = (after.tv_sec - before.tv_sec) * 1000 + (after.tv_usec - before.tv_usec) / 1000;
  printf("pselect except only: n=%d e=%d errno=%d waited=%s\n", n, n >= 0 && FD_ISSET(p[0], &e), n < 0 ? errno : 0, ms >= 80 ? "yes" : "no");
}

static int has_entry(const char *dir, const char *name) {
  DIR *d = opendir(dir);
  if (!d) return 0;
  struct dirent *ent;
  int found = 0;
  while ((ent = readdir(d)) != NULL)
    if (!strcmp(ent->d_name, name)) found = 1;
  closedir(d);
  return found;
}

static const char *tail(const char *path, int parts) {
  const char *p = path + strlen(path);
  while (p > path && parts > 0) {
    --p;
    if (*p == '/') parts--;
  }
  return *p == '/' ? p + 1 : p;
}

static void chdirs(const char *base) {
  char path[512], cwd[512];
  snprintf(path, sizeof path, "%s/q/real/deep", base);
  mkdir(base, 0755);
  snprintf(path, sizeof path, "%s/q", base); mkdir(path, 0755);
  snprintf(path, sizeof path, "%s/q/real", base); mkdir(path, 0755);
  snprintf(path, sizeof path, "%s/q/real/deep", base); mkdir(path, 0755);
  snprintf(path, sizeof path, "%s/q/real/f", base);
  FILE *f = fopen(path, "w");
  if (f) { fputs("hi\n", f); fclose(f); }
  snprintf(path, sizeof path, "%s/q/ln", base);
  unlink(path);
  if (symlink("real/deep", path) != 0) printf("symlink failed %d\n", errno);

  int r1 = chdir(path);
  int r2 = chdir("..");
  if (!getcwd(cwd, sizeof cwd)) strcpy(cwd, "?");
  FILE *g = fopen("f", "r");
  printf("chdir ln/..: rc=%d,%d cwd=%s f=%s deep=%d\n", r1, r2, tail(cwd, 2), g ? "open" : strerror(errno), has_entry(".", "deep"));
  if (g) fclose(g);

}

static void zone(const char *tz, int year, int month) {
  setenv("TZ", tz, 1);
  tzset();
  struct tm in = {0};
  in.tm_year = year - 1900; in.tm_mon = month - 1; in.tm_mday = 15; in.tm_hour = 12;
  time_t t = timegm(&in);
  struct tm out;
  localtime_r(&t, &out);
  char buf[64];
  strftime(buf, sizeof buf, "%H:%M %Z", &out);
  struct tm back = out;
  time_t again = mktime(&back);
  printf("tz %s %04d-%02d: gmtoff=%ld isdst=%d %s mktime=%s\n", tz, year, month, (long)out.tm_gmtoff, out.tm_isdst, buf, again == t ? "ok" : "off");
}

static void sockets(void) {
  int sv[2];
  errno = 0;
  int r = socketpair(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0, sv);
  if (r != 0) { printf("socketpair flags: rc=%d errno=%d\n", r, errno); return; }
  int fl = fcntl(sv[0], F_GETFL), fd = fcntl(sv[1], F_GETFD);
  char c;
  errno = 0;
  ssize_t n = read(sv[0], &c, 1);
  printf("socketpair flags: rc=0 nonblock=%d cloexec=%d read=%zd eagain=%d\n", (fl & O_NONBLOCK) != 0, (fd & FD_CLOEXEC) != 0, n, errno == EAGAIN);
  close(sv[0]); close(sv[1]);
  r = socketpair(AF_UNIX, SOCK_STREAM, 0, sv);
  fl = r == 0 ? fcntl(sv[0], F_GETFL) : -1;
  printf("socketpair plain: rc=%d nonblock=%d\n", r, r == 0 && (fl & O_NONBLOCK) != 0);
}

int main(int argc, char **argv) {
  const char *base = argc > 1 ? argv[1] : "/home/r18";
  setvbuf(stdout, NULL, _IOLBF, 0);
  selects();
  chdirs(base);
  zone("UTC", 2026, 1);
  zone("EST5EDT,M3.2.0,M11.1.0", 2026, 1);
  zone("EST5EDT,M3.2.0,M11.1.0", 2026, 7);
  zone("CET-1CEST,M3.5.0,M10.5.0/3", 2026, 7);
  zone("<+0530>-5:30", 2026, 3);
  sockets();
  printf("r18 done\n");
  return 0;
}
