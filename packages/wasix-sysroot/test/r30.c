#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <semaphore.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

static char bufs[8][64];
static unsigned nb;

static const char *res(int r) {
  char *b = bufs[nb++ % 8];
  if (r < 0) snprintf(b, 64, "-1 %s", strerror(errno));
  else snprintf(b, 64, "%d", r);
  return b;
}

static const char *opened(sem_t *s) {
  char *b = bufs[nb++ % 8];
  if (s == SEM_FAILED) snprintf(b, 64, "FAILED %s", strerror(errno));
  else snprintf(b, 64, "ok");
  return b;
}

static double now(clockid_t c) {
  struct timespec t;
  clock_gettime(c, &t);
  return t.tv_sec + t.tv_nsec / 1e9;
}

static int child_exec(void) {
  sem_t *s = sem_open("/r30exec", 0);
  if (s == SEM_FAILED) {
    printf("exec child: open %s\n", strerror(errno));
    return 1;
  }
  printf("exec child: post %s\n", res(sem_post(s)));
  return 0;
}

int main(int argc, char **argv) {
  setvbuf(stdout, NULL, _IONBF, 0);
  if (argc > 1 && strcmp(argv[1], "exec") == 0) return child_exec();
  sem_unlink("/r30a");
  sem_unlink("/r30b");
  sem_unlink("/r30exec");
  sem_t *a = sem_open("/r30a", O_CREAT | O_EXCL, 0600, 0);
  if (a == SEM_FAILED) {
    printf("sem_open: %s\n", strerror(errno));
    printf("r30 done\n");
    return 0;
  }
  printf("sem_open: ok\n");
  printf("again excl: %s\n", opened(sem_open("/r30a", O_CREAT | O_EXCL, 0600, 0)));
  sem_t *a2 = sem_open("r30a", 0);
  printf("reopen same pointer: %d\n", a2 == a);
  printf("missing: %s\n", opened(sem_open("/r30missing", 0)));
  printf("bad name: %s\n", opened(sem_open("/a/b", O_CREAT, 0600, 0)));
  char longname[300];
  memset(longname, 'x', 260);
  longname[0] = '/';
  longname[260] = 0;
  printf("long name: %s\n", opened(sem_open(longname, O_CREAT, 0600, 0)));
  printf("big value: %s\n", opened(sem_open("/r30big", O_CREAT, 0600, (unsigned)SEM_VALUE_MAX + 1u)));
  int v = -1;
  printf("trywait: %s\n", res(sem_trywait(a)));
  printf("post: %s\n", res(sem_post(a)));
  sem_getvalue(a, &v);
  printf("value: %d\n", v);
  printf("trywait: %s\n", res(sem_trywait(a)));

  struct timespec ts;
  clock_gettime(CLOCK_REALTIME, &ts);
  double t0 = now(CLOCK_REALTIME);
  ts.tv_nsec += 150000000;
  if (ts.tv_nsec >= 1000000000) { ts.tv_sec++; ts.tv_nsec -= 1000000000; }
  int r = sem_timedwait(a, &ts);
  double dt = now(CLOCK_REALTIME) - t0;
  printf("timedwait: %s %s\n", res(r), dt >= 0.14 && dt < 2 ? "not early" : "wrong");
  sem_post(a);
  ts.tv_sec -= 10;
  printf("past deadline with value: %s\n", res(sem_timedwait(a, &ts)));
  ts.tv_nsec = 1000000000;
  printf("bad nsec: %s\n", res(sem_timedwait(a, &ts)));

  sem_t *b = sem_open("/r30b", O_CREAT, 0600, 0);
  pid_t p = fork();
  if (p == 0) {
    for (int i = 0; i < 100; i++) {
      if (sem_wait(a)) _exit(2);
      if (sem_post(b)) _exit(3);
    }
    sem_t *ca = sem_open("/r30a", 0);
    _exit(ca == a ? 7 : 8);
  }
  int ok = 0;
  for (int i = 0; i < 100; i++) {
    sem_post(a);
    if (sem_wait(b) == 0) ok++;
  }
  int st = 0;
  waitpid(p, &st, 0);
  printf("fork ping-pong: %d rounds, child exit %d\n", ok, WIFEXITED(st) ? WEXITSTATUS(st) : -1);

  sem_t *e = sem_open("/r30exec", O_CREAT, 0600, 0);
  p = fork();
  if (p == 0) {
    execlp("r30", "r30", "exec", (char *)NULL);
    _exit(9);
  }
  ts.tv_sec = 0;
  clock_gettime(CLOCK_REALTIME, &ts);
  ts.tv_sec += 10;
  printf("exec handoff: %s\n", res(sem_timedwait(e, &ts)));
  waitpid(p, &st, 0);
  printf("exec child exit %d\n", WIFEXITED(st) ? WEXITSTATUS(st) : -1);

  printf("unlink: %s\n", res(sem_unlink("/r30a")));
  printf("unlink again: %s\n", res(sem_unlink("/r30a")));
  printf("post after unlink: %s\n", res(sem_post(a)));
  printf("close: %s close: %s\n", res(sem_close(a2)), res(sem_close(a)));
  sem_t u;
  sem_init(&u, 0, 1);
  printf("unnamed: %s %s\n", res(sem_trywait(&u)), res(sem_trywait(&u)));
  sem_unlink("/r30b");
  sem_unlink("/r30exec");
  printf("r30 done\n");
  return 0;
}
