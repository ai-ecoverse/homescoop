#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <unistd.h>

static int niceness(void) {
  const char *s = getenv("SLICC_NICE");
  if (!s || !*s) return 0;
  char *end;
  long v = strtol(s, &end, 10);
  if (*end) return 0;
  return v < -20 ? -20 : v > 19 ? 19 : (int)v;
}

static int ours(int which, int who) {
  if (which == PRIO_PROCESS) return who == 0 || who == getpid() ? 0 : -ESRCH;
  if (which == PRIO_PGRP) return who == 0 ? 0 : -ESRCH;
  if (which == PRIO_USER) return who == 0 || (uid_t)who == geteuid() ? 0 : -ESRCH;
  return -EINVAL;
}

int __syscall_getpriority(int which, int who) {
  int r = ours(which, who);
  return r ? r : 20 - niceness();
}

int __syscall_setpriority(int which, int who, int prio) {
  int r = ours(which, who);
  if (r) return r;
  if (prio < -20) prio = -20;
  if (prio > 19) prio = 19;
  if (prio < niceness() && geteuid() != 0) return -EACCES;
  if (prio == 0) return unsetenv("SLICC_NICE") ? -errno : 0;
  char buf[8];
  snprintf(buf, sizeof buf, "%d", prio);
  return setenv("SLICC_NICE", buf, 1) ? -errno : 0;
}
