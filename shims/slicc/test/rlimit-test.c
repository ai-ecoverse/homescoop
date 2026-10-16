/*
 * Resource limits through slicc_libc_gaps.c's __syscall_prlimit64
 * (homescoop#178): rlimit-test prints one line per step,
 * "<step> <rc> <errno name> <cur> <max>".
 */
#define _GNU_SOURCE
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/resource.h>
#include <unistd.h>

static const char *ename(int e) {
  return e == 0 ? "0" : e == EPERM ? "EPERM" : e == EINVAL ? "EINVAL" : strerror(e);
}

static void show(const char *step, int rc, int err, int res) {
  struct rlimit r;
  getrlimit(res, &r);
  printf("%s %d %s %lld %lld\n", step, rc, ename(rc ? err : 0),
         r.rlim_cur == RLIM_INFINITY ? -1LL : (long long)r.rlim_cur,
         r.rlim_max == RLIM_INFINITY ? -1LL : (long long)r.rlim_max);
}

static void set(const char *step, int res, rlim_t cur, rlim_t max) {
  struct rlimit r = {cur, max};
  errno = 0;
  int rc = setrlimit(res, &r);
  show(step, rc, errno, res);
}

int main(void) {
  show("nofile", 0, 0, RLIMIT_NOFILE);
  set("soft-64", RLIMIT_NOFILE, 64, 4096);
  set("soft-back", RLIMIT_NOFILE, 4096, 4096);
  set("hard-up", RLIMIT_NOFILE, 64, 8192);
  set("soft-over-hard", RLIMIT_NOFILE, 5000, 4096);
  set("hard-down", RLIMIT_NOFILE, 512, 1024);
  set("hard-back-up", RLIMIT_NOFILE, 512, 4096);
  show("core", 0, 0, RLIMIT_CORE);
  set("core-0", RLIMIT_CORE, 0, RLIM_INFINITY);
  struct rlimit st;
  getrlimit(RLIMIT_STACK, &st);
  printf("stack-set %d\n", st.rlim_cur > 0 && st.rlim_cur == st.rlim_max);
  errno = 0;
  int rc = prlimit(getpid() + 1, RLIMIT_NOFILE, NULL, &st);
  printf("other-pid %d %s\n", rc, ename(rc ? errno : 0));
  errno = 0;
  rc = getrlimit(RLIM_NLIMITS, &st);
  printf("bad-resource %d %s\n", rc, ename(rc ? errno : 0));
  return 0;
}
