#define _GNU_SOURCE
#include <errno.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

__attribute__((import_module("slicc"), import_name("sigmask_epoll_wait")))
int32_t __slicc_sigmask_epoll_wait(uint32_t set_lo, uint32_t set_hi, int32_t epfd, int32_t events_ptr, int32_t maxevents, int64_t timeout_ns, int32_t nevents_ptr);

__attribute__((import_module("slicc"), import_name("sigwait")))
int32_t __slicc_sigwait(uint32_t set_lo, uint32_t set_hi, int64_t timeout_ns, int32_t sig_ptr);

__attribute__((import_module("slicc"), import_name("sigaction_inherited")))
int32_t __slicc_sigaction_inherited(int32_t ign_ptr);

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

static volatile int usr1, usr2, alrm;
static void on_usr1(int sig) { (void)sig; usr1++; }
static void on_usr2(int sig) { (void)sig; usr2++; }
static void on_alrm(int sig) { (void)sig; alrm++; }

static int blocked(int sig) {
  sigset_t cur;
  sigemptyset(&cur);
  pthread_sigmask(SIG_BLOCK, NULL, &cur);
  return sigismember(&cur, sig) == 1;
}

static void handle(int sig, void (*f)(int)) {
  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_handler = f;
  sigaction(sig, &sa, NULL);
}

static void block(int sig, int how) {
  sigset_t s;
  sigemptyset(&s);
  sigaddset(&s, sig);
  sigprocmask(how, &s, NULL);
}

static void imports(void) {
  uint32_t ev[8];
  uint32_t n = 0, sig = 0;
  unsigned long long ign = 0;
  int32_t e = __slicc_sigmask_epoll_wait(0, 0, -1, (int32_t)(uintptr_t)ev, 1, 0, (int32_t)(uintptr_t)&n);
  printf("kernel sigmask_epoll_wait: %s\n", e == ENOSYS ? "no" : "yes");
  e = __slicc_sigwait(0, 0, 0, (int32_t)(uintptr_t)&sig);
  printf("kernel sigwait: %s\n", e == ENOSYS ? "no" : "yes");
  e = __slicc_sigaction_inherited((int32_t)(uintptr_t)&ign);
  printf("kernel sigaction_inherited: %s\n", e == ENOSYS ? "no" : "yes");
}

static pthread_t main_thread;
static volatile int sender_stop, sender_sent;

static void *sender(void *arg) {
  (void)arg;
  unsigned seed = 32;
  while (!sender_stop) {
    int want = usr1;
    usleep(rand_r(&seed) % 3000);
    pthread_kill(main_thread, SIGUSR1);
    sender_sent++;
    while (usr1 == want && !sender_stop) usleep(200);
  }
  return NULL;
}

static void pwait(void) {
  int ep = epoll_create1(0);
  int p[2];
  pipe(p);
  struct epoll_event in = {.events = EPOLLIN, .data.u64 = 7};
  epoll_ctl(ep, EPOLL_CTL_ADD, p[0], &in);
  struct epoll_event out[4];
  sigset_t empty;
  sigemptyset(&empty);
  handle(SIGUSR1, on_usr1);
  block(SIGUSR1, SIG_BLOCK);
  usr1 = 0;
  main_thread = pthread_self();
  pthread_t t;
  pthread_create(&t, NULL, sender, NULL);
  int rounds = 200, slow = 0, eintr = 0, other = 0;
  double worst = 0;
  for (int i = 0; i < rounds; i++) {
    double t0 = now();
    int r = epoll_pwait(ep, out, 4, 2000, &empty);
    double dt = now() - t0;
    if (dt > worst) worst = dt;
    if (dt > 1) slow++;
    if (r < 0 && errno == EINTR) eintr++;
    else other++;
  }
  sender_stop = 1;
  pthread_join(t, NULL);
  printf("pwait race: rounds=%d eintr=%d other=%d slow=%d worst=%s handled=%s blocked=%d\n", rounds, eintr, other, slow, worst < 1 ? "<1s" : ">1s", usr1 >= rounds ? "all" : "some", blocked(SIGUSR1));
  write(p[1], "x", 1);
  int r = epoll_pwait(ep, out, 4, 2000, &empty);
  printf("pwait ready: %s data=%llu blocked=%d\n", res(r), r == 1 ? (unsigned long long)out[0].data.u64 : 0ULL, blocked(SIGUSR1));
  sigset_t u2;
  sigemptyset(&u2);
  sigaddset(&u2, SIGUSR2);
  handle(SIGUSR2, on_usr2);
  usr2 = 0;
  double t0 = now();
  r = epoll_pwait(ep, out, 4, 0, &u2);
  printf("pwait zero: %s %s\n", res(r), now() - t0 < 0.5 ? "fast" : "slow");
  block(SIGUSR1, SIG_UNBLOCK);
  close(p[0]);
  close(p[1]);
  close(ep);
}

static void *later_kill(void *arg) {
  usleep((useconds_t)(uintptr_t)arg);
  kill(getpid(), SIGUSR1);
  return NULL;
}

static void waits(void) {
  handle(SIGUSR1, on_usr1);
  handle(SIGUSR2, on_usr2);
  handle(SIGALRM, on_alrm);
  sigset_t s;
  sigemptyset(&s);
  sigaddset(&s, SIGUSR1);
  sigaddset(&s, SIGUSR2);
  sigprocmask(SIG_BLOCK, &s, NULL);
  usr1 = usr2 = 0;
  kill(getpid(), SIGUSR2);
  int sig = -7;
  int e = sigwait(&s, &sig);
  printf("sigwait: %s sig=%d handler=%d\n", strerror(e), sig, usr2);
  kill(getpid(), SIGUSR1);
  siginfo_t si;
  memset(&si, 0x55, sizeof si);
  int r = sigwaitinfo(&s, &si);
  printf("sigwaitinfo: %s signo=%d code=%s handler=%d\n", res(r), r > 0 ? si.si_signo : 0, r > 0 && si.si_code == SI_USER ? "SI_USER" : "?", usr1);
  sigset_t u1;
  sigemptyset(&u1);
  sigaddset(&u1, SIGUSR1);
  struct timespec ms200 = {0, 200000000}, zero = {0, 0}, bad = {0, 1000000000}, ms600 = {0, 600000000};
  double t0 = now();
  r = sigtimedwait(&u1, &si, &ms200);
  double dt = now() - t0;
  printf("sigtimedwait 200ms: %s %s\n", res(r), dt >= 0.19 && dt < 1 ? "on time" : dt < 0.19 ? "early" : "late");
  t0 = now();
  r = sigtimedwait(&u1, &si, &zero);
  printf("sigtimedwait 0: %s %s\n", res(r), now() - t0 < 0.1 ? "fast" : "slow");
  r = sigtimedwait(&u1, &si, &bad);
  printf("sigtimedwait bad: %s\n", res(r));
  alrm = 0;
  struct itimerval it = {{0, 0}, {0, 200000}};
  setitimer(ITIMER_REAL, &it, NULL);
  t0 = now();
  r = sigtimedwait(&u1, &si, &ms600);
  dt = now() - t0;
  printf("sigtimedwait through a handled alarm: %s alarm=%d %s\n", res(r), alrm, dt >= 0.59 && dt < 1.2 ? "full timeout" : dt < 0.59 ? "early" : "late");
  pthread_t t;
  pthread_create(&t, NULL, later_kill, (void *)(uintptr_t)200000);
  t0 = now();
  r = sigwaitinfo(&u1, &si);
  dt = now() - t0;
  pthread_join(t, NULL);
  printf("sigwaitinfo from another thread's kill: %s %s handler=%d\n", res(r), dt >= 0.15 && dt < 2 ? "in time" : "off", usr1);
  sigprocmask(SIG_UNBLOCK, &s, NULL);
}

static const char *disp(int sig) {
  struct sigaction old;
  memset(&old, 0, sizeof old);
  sigaction(sig, NULL, &old);
  return old.sa_handler == SIG_IGN ? "ign" : old.sa_handler == SIG_DFL ? "dfl" : "handler";
}

static const char *reaped(void) {
  pid_t p = fork();
  if (p == 0) _exit(3);
  if (p < 0) return "fork failed";
  usleep(300000);
  int st = 0;
  pid_t w = waitpid(p, &st, 0);
  static char b[64];
  if (w < 0) snprintf(b, sizeof b, "reaped (%s)", strerror(errno));
  else snprintf(b, sizeof b, "zombie status=%d", WIFEXITED(st) ? WEXITSTATUS(st) : -1);
  return b;
}

static void inherited(void) {
  printf("inherit: PIPE=%s USR2=%s CHLD=%s TERM=%s\n", disp(SIGPIPE), disp(SIGUSR2), disp(SIGCHLD), disp(SIGTERM));
  printf("inherit child: %s\n", reaped());
  usr2 = 0;
  handle(SIGUSR2, on_usr2);
  raise(SIGUSR2);
  printf("inherit then handled: USR2=%s handler=%d\n", disp(SIGUSR2), usr2);
}

static void nocldwait(void) {
  printf("default child: %s\n", reaped());
  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_handler = SIG_DFL;
  sa.sa_flags = SA_NOCLDWAIT;
  sigaction(SIGCHLD, &sa, NULL);
  printf("SA_NOCLDWAIT child: %s\n", reaped());
  sa.sa_flags = 0;
  sigaction(SIGCHLD, &sa, NULL);
  printf("SIG_DFL again child: %s\n", reaped());
}

int main(int argc, char **argv) {
  setvbuf(stdout, NULL, _IONBF, 0);
  if (argc > 1 && !strcmp(argv[1], "inherit")) {
    inherited();
    return 0;
  }
  imports();
  pwait();
  waits();
  nocldwait();
  printf("r32 done\n");
  return 0;
}
