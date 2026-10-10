// Process credentials through slicc_libc_gaps.c (homescoop#207, needs
// slicc-kernel K1): ids from Module.sliccKernel.cred(), set*id through
// setcred(), names from the kernel's /etc/passwd and /etc/group
// (slicc_pwd.c). Same lines as wasix-sysroot's test/r20.c.
#define _GNU_SOURCE
#include <errno.h>
#include <grp.h>
#include <pwd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void ids(const char *tag) {
  uid_t r, e, s;
  gid_t gr, ge, gs;
  int u = getresuid(&r, &e, &s), g = getresgid(&gr, &ge, &gs);
  printf("%s: uid=%d euid=%d gid=%d egid=%d res=%d:%d/%u,%u,%u/%u,%u,%u\n", tag,
         (int)getuid(), (int)geteuid(), (int)getgid(), (int)getegid(), u, g,
         r, e, s, gr, ge, gs);
}

int main(void) {
  setvbuf(stdout, NULL, _IOLBF, 0);
  ids("ids");

  int n = getgroups(0, NULL);
  gid_t list[64];
  int m = getgroups(64, list);
  printf("groups: n=%d m=%d", n, m);
  for (int i = 0; i < m && i < 64; i++) printf(" %u", list[i]);
  errno = 0;
  int small = n > 1 ? getgroups(1, list) : -2;
  printf(" small=%d errno=%d\n", small, small < 0 && small != -2 ? errno : 0);

  struct passwd *pw = getpwuid(getuid());
  printf("pwuid: %s %s %s\n", pw ? pw->pw_name : "-", pw ? pw->pw_dir : "-", pw ? pw->pw_shell : "-");
  struct group *gp = getgrgid(getgid());
  printf("grgid: %s\n", gp ? gp->gr_name : "-");
  struct passwd *rootpw = getpwnam("root");
  printf("pwnam root: uid=%d dir=%s\n", rootpw ? (int)rootpw->pw_uid : -1, rootpw ? rootpw->pw_dir : "-");
  printf("pwnam 1000: %s\n", getpwnam("user") ? "user exists" : "no static user");

  if (geteuid() == 0) {
    // Root: drop the effective id and take it back (saved id stays 0).
    errno = 0;
    int a = seteuid(1000);
    ids("seteuid 1000");
    int b = seteuid(0);
    printf("root seteuid: %d %d errno=%d euid=%d\n", a, b, errno, (int)geteuid());
    gid_t two[2] = {0, 27};
    int c = setgroups(2, two);
    printf("root setgroups: %d count=%d\n", c, getgroups(0, NULL));
    // setresuid to a user, then nothing gets root back.
    int d = setresuid(1000, 1000, 1000);
    errno = 0;
    int f = setuid(0);
    printf("root drop: %d setuid0=%d errno=%s\n", d, f, errno == EPERM ? "EPERM" : strerror(errno));
    ids("dropped");
  } else {
    errno = 0;
    int a = setuid(0);
    printf("user setuid0: %d errno=%s\n", a, errno == EPERM ? "EPERM" : strerror(errno));
    errno = 0;
    gid_t one[1] = {0};
    int b = setgroups(1, one);
    printf("user setgroups: %d errno=%s\n", b, errno == EPERM ? "EPERM" : strerror(errno));
    int c = setuid(getuid());
    printf("user setuid self: %d\n", c);
  }
  printf("cred done\n");
  return 0;
}
