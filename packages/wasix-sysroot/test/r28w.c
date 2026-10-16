#define _GNU_SOURCE
#include <errno.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/select.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include <wasi/api.h>

__attribute__((import_module("slicc"), import_name("sigmask_set")))
int32_t __slicc_sigmask_set(int32_t how, uint32_t set_lo, uint32_t set_hi, int32_t old_ptr);

__attribute__((import_module("slicc"), import_name("sigwait")))
int32_t __slicc_sigwait(uint32_t set_lo, uint32_t set_hi, int64_t timeout_ns, int32_t sig_ptr);

__attribute__((import_module("slicc"), import_name("sigmask_poll")))
int32_t __slicc_sigmask_poll(uint32_t set_lo, uint32_t set_hi, int32_t in_ptr, int32_t out_ptr, int32_t nsubscriptions, int32_t nevents_ptr);

static volatile int got[65];

static void on_sig(int sig) { got[sig]++; }

static double now(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec + t.tv_nsec / 1e9;
}

static const char *err(int r) {
  static char b[64];
  if (r >= 0) snprintf(b, sizeof b, "%d", r);
  else snprintf(b, sizeof b, "-1 %s", errno == EINTR ? "EINTR" : strerror(errno));
  return b;
}

static const char *fast(double t, double bound) { return t < bound ? "fast" : "slow"; }

static pid_t later(int sig, int ms) {
  pid_t parent = getpid();
  pid_t p = fork();
  if (p == 0) {
    usleep(ms * 1000);
    kill(parent, sig);
    _exit(0);
  }
  return p;
}

static void reap(pid_t p) {
  int st;
  while (waitpid(p, &st, 0) < 0 && errno == EINTR) {}
}

static volatile unsigned long spin_sink;

static void spin(unsigned long n) {
  for (unsigned long i = 0; i < n; i++) spin_sink += i;
}

static int blocked(int sig) {
  sigset_t cur;
  sigemptyset(&cur);
  sigprocmask(SIG_BLOCK, NULL, &cur);
  return sigismember(&cur, sig) == 1;
}

int main(void) {
  setvbuf(stdout, NULL, _IONBF, 0);
  __wasi_subscription_t s = {.u.tag = __WASI_EVENTTYPE_CLOCK, .u.u.clock.id = __WASI_CLOCKID_MONOTONIC, .u.u.clock.timeout = 1};
  __wasi_event_t e;
  uint32_t n = 0;
  uint64_t m = 0;
  printf("kernel sigmask_set: %s\n", __slicc_sigmask_set(SIG_BLOCK, 0, 0, (int32_t)(uintptr_t)&m) == ENOSYS ? "no" : "yes");
  printf("kernel sigmask_poll: %s\n", __slicc_sigmask_poll(0, 0, (int32_t)(uintptr_t)&s, (int32_t)(uintptr_t)&e, 1, (int32_t)(uintptr_t)&n) == ENOSYS ? "no" : "yes");

  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_handler = on_sig;
  int sigs[] = {SIGHUP, SIGINT, SIGTERM, SIGUSR1, SIGUSR2};
  for (unsigned i = 0; i < sizeof sigs / sizeof sigs[0]; i++) sigaction(sigs[i], &sa, NULL);

  sigset_t one, none, all, old;
  sigemptyset(&none);

  sigemptyset(&one);
  sigaddset(&one, SIGUSR2);
  sigprocmask(SIG_BLOCK, &one, NULL);
  kill(getpid(), SIGUSR2);
  struct timespec sec = {1, 0};
  double t0 = now();
  int r = pselect(0, NULL, NULL, NULL, &sec, &none);
  int h = got[SIGUSR2];
  double dt = now() - t0;
  printf("pselect pending: %s handler=%d %s still_blocked=%d\n", err(r), h, fast(dt, 0.5), blocked(SIGUSR2));
  sigprocmask(SIG_SETMASK, &none, NULL);

  sigemptyset(&one);
  sigaddset(&one, SIGUSR1);
  sigprocmask(SIG_BLOCK, &one, NULL);
  pid_t p = later(SIGUSR1, 200);
  t0 = now();
  r = sigsuspend(&none);
  h = got[SIGUSR1];
  dt = now() - t0;
  printf("sigsuspend: %s handler=%d %s still_blocked=%d\n", err(r), h, fast(dt, 1), blocked(SIGUSR1));
  reap(p);
  sigprocmask(SIG_SETMASK, &none, NULL);

  sigemptyset(&all);
  sigaddset(&all, SIGHUP);
  sigaddset(&all, SIGTERM);
  sigaddset(&all, SIGINT);
  sigprocmask(SIG_BLOCK, &all, &old);
  int fds[2];
  pipe(fds);
  for (int k = 0; k < 2; k++) {
    int sig = k == 0 ? SIGHUP : SIGTERM;
    p = later(sig, 200);
    fd_set rd;
    FD_ZERO(&rd);
    FD_SET(fds[0], &rd);
    struct timespec ten = {10, 0};
    t0 = now();
    r = pselect(fds[0] + 1, &rd, NULL, NULL, &ten, &old);
    h = got[sig];
    dt = now() - t0;
    printf("agent %s: %s handler=%d %s\n", k == 0 ? "HUP" : "TERM", err(r), h, fast(dt, 1));
    reap(p);
  }

  int delays[] = {5, 20, 50, 90, 140, 200, 260, 10};
  int rounds = 0, ran = 0;
  for (unsigned k = 0; k < sizeof delays / sizeof delays[0]; k++) {
    int before = got[SIGUSR1];
    sigaddset(&all, SIGUSR1);
    sigprocmask(SIG_BLOCK, &all, NULL);
    p = later(SIGUSR1, delays[k]);
    fd_set rd;
    FD_ZERO(&rd);
    FD_SET(fds[0], &rd);
    struct timespec two = {2, 0};
    r = pselect(fds[0] + 1, &rd, NULL, NULL, &two, &old);
    h = got[SIGUSR1];
    rounds++;
    if (r < 0 && errno == EINTR && h == before + 1) ran++;
    reap(p);
  }
  printf("agent rounds: %d/%d\n", ran, rounds);

  p = later(SIGINT, 200);
  struct pollfd pf = {.fd = fds[0], .events = POLLIN};
  struct timespec ten = {10, 0};
  t0 = now();
  r = ppoll(&pf, 1, &ten, &old);
  h = got[SIGINT];
  dt = now() - t0;
  printf("ssh INT: %s handler=%d %s still_blocked=%d\n", err(r), h, fast(dt, 1), blocked(SIGINT));
  reap(p);
  write(fds[1], "x", 1);
  r = ppoll(&pf, 1, &ten, &old);
  printf("ppoll ready: %s revents=%s\n", err(r), pf.revents & POLLIN ? "IN" : "-");
  sigprocmask(SIG_SETMASK, &none, NULL);

  char drain[8];
  read(fds[0], drain, sizeof drain);
  double c0 = now();
  spin(20000000);
  double per = (now() - c0) / 20000000;
  unsigned long n400 = per > 0 ? (unsigned long)(0.4 / per) : 20000000;
  int wb = got[SIGUSR1];
  p = later(SIGUSR1, 100);
  spin(n400);
  int before_wait = got[SIGUSR1] - wb;
  fd_set wr;
  FD_ZERO(&wr);
  FD_SET(fds[0], &wr);
  struct timespec ten2 = {10, 0};
  t0 = now();
  r = pselect(fds[0] + 1, &wr, NULL, NULL, &ten2, NULL);
  h = got[SIGUSR1] - wb;
  dt = now() - t0;
  printf("window: arrived_before_wait handler=%d; pselect %s handler=%d %s\n", before_wait, err(r), h, fast(dt, 1));
  reap(p);

  wb = got[SIGUSR1];
  p = later(SIGUSR1, 100);
  spin(n400);
  before_wait = got[SIGUSR1] - wb;
  FD_ZERO(&wr);
  FD_SET(fds[0], &wr);
  t0 = now();
  r = pselect(fds[0] + 1, &wr, NULL, NULL, &ten2, &none);
  h = got[SIGUSR1] - wb;
  dt = now() - t0;
  printf("window masked: arrived_before_wait handler=%d; pselect %s handler=%d %s\n", before_wait, err(r), h, fast(dt, 1));
  reap(p);

  uint32_t probe_sig = 0;
  if (__slicc_sigwait(0, 0, 0, (int32_t)(uintptr_t)&probe_sig) != ENOSYS) {
    printf("sigwait family: slicc.sigwait (r32)\n");
  } else {
    siginfo_t si;
    struct timespec z = {0, 0};
    r = sigtimedwait(&all, &si, &z);
    printf("sigtimedwait: %s\n", err(r));
    r = sigwaitinfo(&all, &si);
    printf("sigwaitinfo: %s\n", err(r));
    int sg = -7;
    printf("sigwait: %s sig=%d\n", strerror(sigwait(&all, &sg)), sg);
  }
  printf("r28w done\n");
  return 0;
}
