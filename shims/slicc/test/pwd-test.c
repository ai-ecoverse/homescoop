/*
 * passwd/group lookups through slicc_pwd.c, as screen and bash use them.
 * Prints one line per lookup; flock() pulls Emscripten's
 * emscripten_libc_stubs.o (which also defines getpwuid/getpwnam/getpwent)
 * into the link, so this also proves the --wrap avoids a duplicate symbol.
 */
#include <errno.h>
#include <grp.h>
#include <pwd.h>
#include <stdio.h>
#include <string.h>
#include <sys/file.h>
#include <unistd.h>

static void show_pw(const char *tag, struct passwd *pw) {
  if (!pw) {
    printf("%s none\n", tag);
    return;
  }
  printf("%s %s:%s:%u:%u:%s:%s:%s\n", tag, pw->pw_name, pw->pw_passwd, (unsigned)pw->pw_uid,
         (unsigned)pw->pw_gid, pw->pw_gecos, pw->pw_dir, pw->pw_shell);
}

static void show_gr(const char *tag, struct group *gr) {
  if (!gr) {
    printf("%s none\n", tag);
    return;
  }
  printf("%s %s:%u:", tag, gr->gr_name, (unsigned)gr->gr_gid);
  for (char **m = gr->gr_mem; *m; m++) printf("%s%s", m == gr->gr_mem ? "" : ",", *m);
  printf("\n");
}

int main(void) {
  printf("flock %d\n", flock(0, LOCK_SH));
  // uid 1000 by number: getuid() is the kernel's (cred-test.c).
  show_pw("uid", getpwuid(1000));
  show_pw("root", getpwnam("root"));
  show_pw("nobody", getpwnam("no-such-user"));
  show_pw("uid4242", getpwuid(4242));

  struct passwd pw, *res = NULL;
  char small[8], big[512];
  printf("r-small %d %s\n", getpwuid_r(1000, &pw, small, sizeof small, &res), res ? "res" : "null");
  printf("r-big %d %s\n", getpwnam_r("web_user", &pw, big, sizeof big, &res), res ? pw.pw_dir : "null");
  printf("r-missing %d %s\n", getpwnam_r("no-such-user", &pw, big, sizeof big, &res), res ? "res" : "null");

  int n = 0;
  setpwent();
  for (struct passwd *e; (e = getpwent());) printf("ent %d %s\n", n++, e->pw_name);
  endpwent();

  show_gr("gid", getgrgid(1000));
  show_gr("rootgr", getgrnam("root"));
  show_gr("nogr", getgrnam("no-such-group"));
  return 0;
}
