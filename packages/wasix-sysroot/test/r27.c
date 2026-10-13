#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/times.h>
#include <time.h>
#include <unistd.h>
#include <utime.h>

static long long now_s(void) {
  struct timespec ts;
  clock_gettime(CLOCK_REALTIME, &ts);
  return ts.tv_sec;
}

static void reset(const char *p) {
  struct timespec t[2] = {{1000000000, 0}, {1100000000, 0}};
  utimensat(AT_FDCWD, p, t, 0);
}

static void show(const char *label, int r, const char *p) {
  int e = errno;
  struct stat st;
  stat(p, &st);
  long long n = now_s();
  long long a = st.st_atime, m = st.st_mtime;
  const char *as = a == 1000000000 ? "kept" : a == 5 ? "5" : (a >= n - 5 && a <= n + 1) ? "now" : "other";
  const char *ms = m == 1100000000 ? "kept" : m == 7 ? "7" : (m >= n - 5 && m <= n + 1) ? "now" : "other";
  printf("%s: r=%d errno=%s atime=%s mtime=%s\n", label, r, r ? (e == EINVAL ? "EINVAL" : e == ENOENT ? "ENOENT" : strerror(e)) : "0", as, ms);
  errno = 0;
}

static void burn(double seconds) {
  struct timespec a, b;
  clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &a);
  volatile double x = 0;
  do {
    for (int i = 0; i < 100000; i++) x += i;
    clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &b);
  } while ((b.tv_sec - a.tv_sec) + (b.tv_nsec - a.tv_nsec) / 1e9 < seconds);
}

int main(void) {
  setvbuf(stdout, NULL, _IONBF, 0);
  const char *p = "/tmp/r27-f";
  close(open(p, O_CREAT | O_WRONLY | O_TRUNC, 0644));
  int fd = open(p, O_RDWR);
  struct timespec t[2];
  reset(p); show("utimensat NULL", utimensat(AT_FDCWD, p, NULL, 0), p);
  reset(p); t[0] = (struct timespec){0, UTIME_NOW}; t[1] = (struct timespec){0, UTIME_NOW}; show("utimensat NOW,NOW", utimensat(AT_FDCWD, p, t, 0), p);
  reset(p); t[0] = (struct timespec){0, UTIME_OMIT}; t[1] = (struct timespec){7, 0}; show("utimensat OMIT,7", utimensat(AT_FDCWD, p, t, 0), p);
  reset(p); t[0] = (struct timespec){5, 0}; t[1] = (struct timespec){0, UTIME_OMIT}; show("utimensat 5,OMIT", utimensat(AT_FDCWD, p, t, 0), p);
  reset(p); t[0] = (struct timespec){0, UTIME_NOW}; t[1] = (struct timespec){7, 0}; show("utimensat NOW,7", utimensat(AT_FDCWD, p, t, 0), p);
  reset(p); t[0] = (struct timespec){5, 0}; t[1] = (struct timespec){0, UTIME_NOW}; show("utimensat 5,NOW", utimensat(AT_FDCWD, p, t, 0), p);
  reset(p); t[0] = (struct timespec){0, UTIME_OMIT}; t[1] = (struct timespec){0, UTIME_OMIT}; show("utimensat OMIT,OMIT", utimensat(AT_FDCWD, p, t, 0), p);
  reset(p); t[0] = (struct timespec){5, 0}; t[1] = (struct timespec){7, 0}; show("utimensat 5,7", utimensat(AT_FDCWD, p, t, 0), p);
  reset(p); t[0] = (struct timespec){5, 1000000000}; t[1] = (struct timespec){7, 0}; show("utimensat bad nsec", utimensat(AT_FDCWD, p, t, 0), p);
  int dfd = open("/tmp", O_RDONLY | O_DIRECTORY);
  reset(p); show("utimensat dirfd NULL", utimensat(dfd, "r27-f", NULL, 0), p);
  reset(p); show("futimens NULL", futimens(fd, NULL), p);
  reset(p); t[0] = (struct timespec){0, UTIME_OMIT}; t[1] = (struct timespec){0, UTIME_NOW}; show("futimens OMIT,NOW", futimens(fd, t), p);
  reset(p); show("utimes NULL", utimes(p, NULL), p);
  reset(p); show("utime NULL", utime(p, NULL), p);
  struct utimbuf ub = {5, 7};
  reset(p); show("utime 5,7", utime(p, &ub), p);
  show("utimensat missing NULL", utimensat(AT_FDCWD, "/tmp/r27-missing", NULL, 0), p);
  close(fd);
  close(dfd);

  struct tms t0, t1;
  struct rusage r0, r1;
  clock_t c0 = clock(), e0 = times(&t0);
  getrusage(RUSAGE_SELF, &r0);
  burn(0.5);
  clock_t c1 = clock(), e1 = times(&t1);
  getrusage(RUSAGE_SELF, &r1);
  usleep(400000);
  struct tms t2;
  struct rusage r2;
  clock_t c2 = clock(), e2 = times(&t2);
  getrusage(RUSAGE_SELF, &r2);
  double ru1 = (r1.ru_utime.tv_sec - r0.ru_utime.tv_sec) + (r1.ru_utime.tv_usec - r0.ru_utime.tv_usec) / 1e6;
  double ru2 = (r2.ru_utime.tv_sec - r1.ru_utime.tv_sec) + (r2.ru_utime.tv_usec - r1.ru_utime.tv_usec) / 1e6;
  long tck = sysconf(_SC_CLK_TCK);
  printf("burn: clock=%.2f tms_utime=%.2f ru_utime=%.2f\n", (double)(c1 - c0) / CLOCKS_PER_SEC, (double)(t1.tms_utime - t0.tms_utime) / tck, ru1);
  printf("sleep: clock=%.2f tms_utime=%.2f ru_utime=%.2f elapsed=%.1f\n", (double)(c2 - c1) / CLOCKS_PER_SEC, (double)(t2.tms_utime - t1.tms_utime) / tck, ru2, (double)(e2 - e1) / tck);
  printf("stime=%lld cutime=%lld cstime=%lld ru_stime=%lld.%06lld\n", (long long)t2.tms_stime, (long long)t2.tms_cutime, (long long)t2.tms_cstime, (long long)r2.ru_stime.tv_sec, (long long)r2.ru_stime.tv_usec);
  struct rusage rc;
  printf("children: %d %lld\n", getrusage(RUSAGE_CHILDREN, &rc), (long long)rc.ru_utime.tv_sec);
  errno = 0;
  printf("bad who: %d %s\n", getrusage(42, &rc), errno == EINVAL ? "EINVAL" : strerror(errno));
  printf("r27 done\n");
  return 0;
}
