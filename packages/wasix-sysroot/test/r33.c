/* wasix-sysroot -34 probe: the signal sender in siginfo_t (homescoop#770),
 * SA_SIGINFO handlers, flock() (slicc-kernel#893), poll on a pipe write end
 * without readers (#629) and a hangup during an events-0 wait (#559). */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/time.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

__attribute__((import_module("slicc"), import_name("sigwait_info")))
int32_t __slicc_sigwait_info(uint32_t set_lo, uint32_t set_hi, int64_t timeout_ns, int32_t info_ptr);
__attribute__((import_module("slicc"), import_name("flock")))
int32_t __slicc_flock(int32_t fd, int32_t op);

static double now(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec + t.tv_nsec / 1e9;
}

static char bufs[8][96];
static unsigned next_buf;
static const char *res(int r) {
  char *b = bufs[next_buf++ % 8];
  if (r < 0) snprintf(b, sizeof bufs[0], "-1 %s", strerror(errno));
  else snprintf(b, sizeof bufs[0], "%d", r);
  return b;
}

static const char *code(int c) {
  switch (c) {
  case SI_USER: return "SI_USER";
  case SI_TKILL: return "SI_TKILL";
  case SI_KERNEL: return "SI_KERNEL";
  case CLD_EXITED: return "CLD_EXITED";
  case CLD_KILLED: return "CLD_KILLED";
  default: {
    char *b = bufs[next_buf++ % 8];
    snprintf(b, sizeof bufs[0], "%d", c);
    return b;
  }
  }
}

static void block(int sig) {
  sigset_t s;
  sigemptyset(&s);
  sigaddset(&s, sig);
  pthread_sigmask(SIG_BLOCK, &s, NULL);
}

static const char *who(pid_t pid, pid_t want, uid_t uid) {
  char *b = bufs[next_buf++ % 8];
  snprintf(b, sizeof bufs[0], "pid=%s uid=%s", pid == want ? "sender" : pid == 0 ? "0" : "other", uid == getuid() ? "mine" : "other");
  return b;
}

/* sigwaitinfo: a forked child's kill(getppid()), then its exit (SIGCHLD). */
static void wait_fork(void) {
  block(SIGUSR1);
  block(SIGCHLD);
  pid_t c = fork();
  if (c == 0) {
    kill(getppid(), SIGUSR1);
    usleep(100000);
    _exit(7);
  }
  sigset_t s;
  sigemptyset(&s);
  sigaddset(&s, SIGUSR1);
  siginfo_t si;
  int r = sigwaitinfo(&s, &si);
  printf("sigwaitinfo kill from child: %s code=%s %s\n", res(r), code(si.si_code), who(si.si_pid, c, si.si_uid));
  sigemptyset(&s);
  sigaddset(&s, SIGCHLD);
  struct timespec ts = { 5, 0 };
  r = sigtimedwait(&s, &si, &ts);
  printf("sigtimedwait SIGCHLD: %s code=%s %s status=%d\n", res(r), code(si.si_code), who(si.si_pid, c, si.si_uid), si.si_status);
  waitpid(c, NULL, 0);
}

static pthread_t main_thread;
static volatile int waiter_ready;
static siginfo_t waiter_si;
static int waiter_r;
static void *waiter(void *arg) {
  (void)arg;
  sigset_t s;
  sigemptyset(&s);
  sigaddset(&s, SIGUSR2);
  waiter_ready = 1;
  waiter_r = sigwaitinfo(&s, &waiter_si);
  return NULL;
}

static void wait_tkill(void) {
  block(SIGUSR2);
  pthread_t t;
  pthread_create(&t, NULL, waiter, NULL);
  while (!waiter_ready) usleep(1000);
  usleep(50000);
  pthread_kill(t, SIGUSR2);
  pthread_join(t, NULL);
  printf("sigwaitinfo pthread_kill: %s code=%s %s\n", res(waiter_r), code(waiter_si.si_code), who(waiter_si.si_pid, getpid(), waiter_si.si_uid));
}

static volatile int got_signo, got_code, got_pid, got_uid, got_ctx;
static void on_info(int sig, siginfo_t *si, void *ctx) {
  got_signo = si->si_signo == sig ? sig : -1;
  got_code = si->si_code;
  got_pid = si->si_pid;
  got_uid = si->si_uid;
  got_ctx = ctx != NULL;
}

static void info_handler(void) {
  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_sigaction = on_info;
  sa.sa_flags = SA_SIGINFO;
  sigaction(SIGHUP, &sa, NULL);
  pid_t c = fork();
  if (c == 0) {
    kill(getppid(), SIGHUP);
    _exit(0);
  }
  for (int i = 0; i < 500 && !got_signo; i++) usleep(10000);
  printf("SA_SIGINFO handler, kill from child: signo=%d code=%s %s ctx=%d\n", got_signo, code(got_code), who(got_pid, c, got_uid), got_ctx);
  waitpid(c, NULL, 0);
  got_signo = 0;
  raise(SIGHUP);
  for (int i = 0; i < 100 && !got_signo; i++) usleep(10000);
  printf("SA_SIGINFO handler, raise: signo=%d code=%s %s\n", got_signo, code(got_code), who(got_pid, getpid(), got_uid));
}

static volatile int alarms;
static void on_alrm(int sig) { (void)sig; alarms++; }

static void flocks(void) {
  int p[2];
  pipe(p);
  printf("flock pipe read end ex: %s\n", res(flock(p[0], LOCK_EX)));
  printf("flock pipe write end ex|nb: %s\n", res(flock(p[1], LOCK_EX | LOCK_NB)));
  printf("flock pipe read end un: %s\n", res(flock(p[0], LOCK_UN)));
  printf("flock pipe write end ex|nb again: %s\n", res(flock(p[1], LOCK_EX | LOCK_NB)));
  close(p[0]);
  close(p[1]);

  int f = open("/tmp/r33.lock", O_CREAT | O_RDWR | O_TRUNC, 0644);
  close(f);
  int a = open("/tmp/r33.lock", O_RDONLY), b = open("/tmp/r33.lock", O_RDONLY);
  printf("flock read-only a ex: %s\n", res(flock(a, LOCK_EX)));
  printf("flock read-only b ex|nb: %s\n", res(flock(b, LOCK_EX | LOCK_NB)));
  printf("flock read-only b sh|nb: %s\n", res(flock(b, LOCK_SH | LOCK_NB)));
  int d = dup(a);
  printf("flock dup of a ex|nb: %s\n", res(flock(d, LOCK_EX | LOCK_NB)));
  pid_t c = fork();
  if (c == 0) _exit(flock(a, LOCK_EX | LOCK_NB) == 0 ? 0 : errno);
  int st = 0;
  waitpid(c, &st, 0);
  printf("flock inherited a in a child ex|nb: %s\n", WEXITSTATUS(st) ? strerror(WEXITSTATUS(st)) : "0");
  printf("flock a un: %s\n", res(flock(a, LOCK_UN)));
  printf("flock read-only b ex|nb after: %s\n", res(flock(b, LOCK_EX | LOCK_NB)));
  printf("flock bad fd: %s\n", res(flock(-1, LOCK_SH)));
  printf("flock bad op: %s\n", res(flock(b, 99)));
  flock(b, LOCK_UN);

  /* A holder in a child (its own open) for 400 ms; the parent's blocking
   * LOCK_EX gets a handled SIGALRM at 100 ms. */
  for (int restart = 0; restart < 2; restart++) {
    struct sigaction sa;
    memset(&sa, 0, sizeof sa);
    sa.sa_handler = on_alrm;
    sa.sa_flags = restart ? SA_RESTART : 0;
    sigaction(SIGALRM, &sa, NULL);
    int go[2];
    pipe(go);
    pid_t h = fork();
    if (h == 0) {
      int x = open("/tmp/r33.lock", O_RDONLY);
      flock(x, LOCK_EX);
      write(go[1], "x", 1);
      usleep(400000);
      _exit(0);
    }
    char ch;
    read(go[0], &ch, 1);
    alarms = 0;
    struct itimerval it = { { 0, 0 }, { 0, 100000 } };
    setitimer(ITIMER_REAL, &it, NULL);
    double t0 = now();
    int r = flock(b, LOCK_EX);
    double dt = now() - t0;
    printf("flock wait, %s handler: %s alarm=%d %s\n", restart ? "SA_RESTART" : "plain", res(r), alarms,
           r == 0 ? (dt > 0.3 ? "after the holder" : "early") : (dt < 0.3 ? "at the signal" : "late"));
    flock(b, LOCK_UN);
    waitpid(h, NULL, 0);
    close(go[0]);
    close(go[1]);
  }
  close(a);
  close(b);
  close(d);
}

static const char *rev(short r) {
  char *b = bufs[next_buf++ % 8];
  b[0] = 0;
  if (r & POLLIN) strcat(b, "|POLLIN");
  if (r & POLLOUT) strcat(b, "|POLLOUT");
  if (r & POLLERR) strcat(b, "|POLLERR");
  if (r & POLLHUP) strcat(b, "|POLLHUP");
  if (r & POLLNVAL) strcat(b, "|POLLNVAL");
  return b[0] ? b + 1 : "0";
}

static void polls(void) {
  for (int pp = 0; pp < 2; pp++) {
    const char *n = pp ? "ppoll" : "poll";
    struct timespec one = { 1, 0 };
    int w[2];
    pipe(w);
    close(w[0]);
    struct pollfd f = { w[1], POLLOUT, 0 };
    int r = pp ? ppoll(&f, 1, &one, NULL) : poll(&f, 1, 1000);
    printf("%s POLLOUT, reader gone: %s revents=%s\n", n, res(r), rev(f.revents));
    close(w[1]);

    int q[2];
    pipe(q);
    write(q[1], "x", 1);
    pid_t c = fork();
    if (c == 0) {
      usleep(200000);
      _exit(0);
    }
    close(q[1]);
    struct pollfd g = { q[0], 0, 0 };
    struct timespec three = { 3, 0 };
    double t0 = now();
    r = pp ? ppoll(&g, 1, &three, NULL) : poll(&g, 1, 3000);
    double dt = now() - t0;
    printf("%s events0 readable, forked writer exits later: %s revents=%s %s\n", n, res(r), rev(g.revents), dt < 1 ? "in time" : "late");
    waitpid(c, NULL, 0);
    close(q[0]);
  }
}

int main(int argc, char **argv) {
  (void)argc;
  (void)argv;
  setvbuf(stdout, NULL, _IONBF, 0);
  main_thread = pthread_self();
  struct { uint32_t size; int32_t signo, code, pid; uint32_t uid; int32_t status; } k = { 24 };
  printf("kernel sigwait_info: %s\n", __slicc_sigwait_info(0, 0, 0, (int32_t)(uintptr_t)&k) == ENOSYS ? "no" : "yes");
  printf("kernel flock: %s\n", __slicc_flock(-1, LOCK_SH) == ENOSYS ? "no" : "yes");
  wait_fork();
  wait_tkill();
  info_handler();
  flocks();
  polls();
  printf("r33 done\n");
  return 0;
}
