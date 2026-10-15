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
#include <sys/epoll.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

__attribute__((import_module("slicc"), import_name("sigmask_set")))
int32_t __slicc_sigmask_set(int32_t how, uint32_t set_lo, uint32_t set_hi, int32_t old_ptr);

static double now(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec + t.tv_nsec / 1e9;
}

static char bufs[8][64];
static unsigned next_buf;

static const char *res(int r) {
  char *b = bufs[next_buf++ % 8];
  if (r < 0) snprintf(b, sizeof bufs[0], "-1 %s", strerror(errno));
  else snprintf(b, sizeof bufs[0], "%d", r);
  return b;
}

static volatile int usr1;
static void on_usr1(int sig) { (void)sig; usr1++; }

static int blocked(int sig) {
  sigset_t cur;
  sigemptyset(&cur);
  pthread_sigmask(SIG_BLOCK, NULL, &cur);
  return sigismember(&cur, sig) == 1;
}

static void polls(void) {
  int a[2], b[2];
  pipe(a);
  pipe(b);
  write(a[1], "x", 1);
  close(99);
  sigset_t empty;
  sigemptyset(&empty);
  struct timespec ms100 = {0, 100000000}, ms200 = {0, 200000000}, s5 = {5, 0}, zero = {0, 0};
  for (int pp = 0; pp < 2; pp++) {
    const char *n = pp ? "ppoll" : "poll";
    struct pollfd f[4] = {{a[0], POLLIN, 0}, {b[0], 0, 0}, {b[0], POLLPRI, 0}, {-1, POLLIN, 0}};
    int r = pp ? ppoll(f, 4, &ms100, &empty) : poll(f, 4, 100);
    printf("%s mixed: %s revents=%d,%d,%d,%d\n", n, res(r), f[0].revents, f[1].revents, f[2].revents, f[3].revents);
    struct pollfd z[2] = {{b[0], 0, 0}, {a[0], 0, 0}};
    double t0 = now();
    r = pp ? ppoll(z, 2, &ms200, NULL) : poll(z, 2, 200);
    double dt = now() - t0;
    printf("%s none: %s revents=%d,%d %s\n", n, res(r), z[0].revents, z[1].revents, dt >= 0.15 && dt < 2 ? "waited" : "wrong");
    struct pollfd v[2] = {{99, 0, 0}, {b[0], POLLIN, 0}};
    t0 = now();
    r = pp ? ppoll(v, 2, &s5, &empty) : poll(v, 2, 5000);
    dt = now() - t0;
    printf("%s nval: %s nval=%d revents=%d %s\n", n, res(r), v[0].revents == POLLNVAL, v[1].revents, dt < 1 ? "fast" : "slow");
    struct pollfd o[1] = {{b[0], 0x4, 0}};
    r = pp ? ppoll(o, 1, &zero, NULL) : poll(o, 1, 0);
    printf("%s other bits: %s revents=%d\n", n, res(r), o[0].revents);
  }
  close(a[0]); close(a[1]); close(b[0]); close(b[1]);
}

static void epolls(int kmask) {
  int ep = epoll_create1(EPOLL_CLOEXEC);
  if (ep < 0) {
    printf("epoll: %s\n", res(ep));
    return;
  }
  printf("epoll: yes cloexec=%d\n", (fcntl(ep, F_GETFD) & FD_CLOEXEC) != 0);
  int c[2];
  pipe(c);
  struct epoll_event e = {.events = EPOLLIN, .data.u64 = 0x100000000ULL};
  printf("ctl add: %s\n", res(epoll_ctl(ep, EPOLL_CTL_ADD, c[0], &e)));
  printf("ctl add again: %s\n", res(epoll_ctl(ep, EPOLL_CTL_ADD, c[0], &e)));
  write(c[1], "y", 1);
  struct epoll_event out[8];
  memset(out, 0xff, sizeof out);
  int r = epoll_wait(ep, out, 8, 1000);
  printf("wait: %s events=%x data=%llx\n", res(r), r > 0 ? out[0].events : 0, r > 0 ? (unsigned long long)out[0].data.u64 : 0ULL);
  e.data.u64 = 0;
  printf("ctl mod: %s\n", res(epoll_ctl(ep, EPOLL_CTL_MOD, c[0], &e)));
  memset(out, 0xff, sizeof out);
  r = epoll_wait(ep, out, 8, 1000);
  printf("wait mod: %s data=%llx\n", res(r), r > 0 ? (unsigned long long)out[0].data.u64 : 0ULL);
  printf("ctl del: %s\n", res(epoll_ctl(ep, EPOLL_CTL_DEL, c[0], NULL)));
  printf("ctl del again: %s\n", res(epoll_ctl(ep, EPOLL_CTL_DEL, c[0], NULL)));
  printf("ctl bad op: %s\n", res(epoll_ctl(ep, 7, c[0], &e)));
  printf("ctl not epoll: %s\n", res(epoll_ctl(c[1], EPOLL_CTL_ADD, c[0], &e)));
  printf("wait not epoll: %s\n", res(epoll_wait(c[1], out, 8, 0)));
  printf("wait idle: %s\n", res(epoll_wait(ep, out, 8, 0)));

  enum { N = 70 };
  int ep2 = epoll_create1(0);
  int m[N][2];
  for (int i = 0; i < N; i++) {
    pipe(m[i]);
    write(m[i][1], "z", 1);
    struct epoll_event me = {.events = EPOLLIN, .data.u32 = 1000 + i};
    epoll_ctl(ep2, EPOLL_CTL_ADD, m[i][0], &me);
  }
  struct epoll_event big[100];
  r = epoll_wait(ep2, big, 100, 1000);
  int seen[N] = {0}, distinct = 0;
  for (int i = 0; i < r; i++) {
    unsigned d = big[i].data.u32 - 1000;
    if (d < N && !seen[d]) { seen[d] = 1; distinct++; }
  }
  printf("many: %s distinct=%d\n", res(r), distinct);
  for (int i = 0; i < N; i++) { close(m[i][0]); close(m[i][1]); }
  close(ep2);

  if (kmask) {
    struct sigaction sa;
    memset(&sa, 0, sizeof sa);
    sa.sa_handler = on_usr1;
    sigaction(SIGUSR1, &sa, NULL);
    e.events = EPOLLIN;
    epoll_ctl(ep, EPOLL_CTL_ADD, c[0], &e);
    char ch;
    read(c[0], &ch, 1);
    sigset_t s, empty;
    sigemptyset(&s);
    sigaddset(&s, SIGUSR1);
    sigemptyset(&empty);
    sigprocmask(SIG_BLOCK, &s, NULL);
    usr1 = 0;
    kill(getpid(), SIGUSR1);
    double t0 = now();
    r = epoll_pwait(ep, out, 8, 3000, &empty);
    double dt = now() - t0;
    printf("pwait: %s handler=%d %s blocked=%d\n", res(r), usr1, dt < 1 ? "fast" : "slow", blocked(SIGUSR1));
    sigprocmask(SIG_UNBLOCK, &s, NULL);
  }
  close(c[0]); close(c[1]);
  close(ep);
}

static void *rt_thread(void *arg) {
  (void)arg;
  printf("rt thread=%d\n", blocked(40));
  return NULL;
}

static void rt(void) {
  sigset_t s;
  sigemptyset(&s);
  sigaddset(&s, 40);
  sigprocmask(SIG_BLOCK, &s, NULL);
  printf("rt main=%d\n", blocked(40));
  pthread_t t;
  pthread_create(&t, NULL, rt_thread, NULL);
  pthread_join(t, NULL);
  pid_t p = fork();
  if (p == 0) {
    printf("rt child=%d\n", blocked(40));
    fflush(stdout);
    execlp("r29", "r29", "show40", (char *)NULL);
    printf("rt exec: %s\n", res(-1));
    _exit(3);
  }
  int st = 0;
  waitpid(p, &st, 0);
  printf("rt child exit=%d\n", WIFEXITED(st) ? WEXITSTATUS(st) : -1);
  sigprocmask(SIG_UNBLOCK, &s, NULL);
}

static pthread_mutex_t mu = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t cv = PTHREAD_COND_INITIALIZER;
static int stage;

static void set_stage(int n) {
  pthread_mutex_lock(&mu);
  stage = n;
  pthread_cond_broadcast(&cv);
  pthread_mutex_unlock(&mu);
}

static void wait_stage(int n) {
  pthread_mutex_lock(&mu);
  while (stage < n) pthread_cond_wait(&cv, &mu);
  pthread_mutex_unlock(&mu);
}

static void *term_thread(void *arg) {
  (void)arg;
  sigset_t s;
  sigemptyset(&s);
  sigaddset(&s, SIGTERM);
  pthread_sigmask(SIG_BLOCK, &s, NULL);
  set_stage(1);
  wait_stage(2);
  pthread_sigmask(SIG_UNBLOCK, &s, NULL);
  sleep(2);
  printf("bothterm: thread survived\n");
  return NULL;
}

static int bothterm(void) {
  sigset_t s;
  sigemptyset(&s);
  sigaddset(&s, SIGTERM);
  sigprocmask(SIG_BLOCK, &s, NULL);
  pthread_t t;
  pthread_create(&t, NULL, term_thread, NULL);
  wait_stage(1);
  pthread_kill(t, SIGTERM);
  set_stage(2);
  pthread_join(t, NULL);
  printf("bothterm: survived\n");
  return 0;
}

int main(int argc, char **argv) {
  setvbuf(stdout, NULL, _IONBF, 0);
  if (argc > 1 && strcmp(argv[1], "show40") == 0) {
    printf("rt exec=%d\n", blocked(40));
    return 0;
  }
  if (argc > 1 && strcmp(argv[1], "bothterm") == 0) return bothterm();
  uint64_t probe = 0;
  int kmask = __slicc_sigmask_set(SIG_BLOCK, 0, 0, (int32_t)(uintptr_t)&probe) != ENOSYS;
  printf("kernel sigmask: %s\n", kmask ? "yes" : "no");
  polls();
  epolls(kmask);
  if (kmask) rt();
  printf("r29 done\n");
  return 0;
}
