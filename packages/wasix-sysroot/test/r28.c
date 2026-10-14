#include <errno.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

__attribute__((import_module("slicc"), import_name("sigmask_set")))
int32_t __slicc_sigmask_set(int32_t how, uint32_t set_lo, uint32_t set_hi, int32_t old_ptr);

static volatile int usr1;
static volatile int usr1_in_thread;
static _Thread_local int in_thread;

static void on_usr1(int sig) {
  (void)sig;
  usr1++;
  if (in_thread) usr1_in_thread++;
}

static char bufs[8][128];
static unsigned next_buf;

static const char *names(const sigset_t *s) {
  char *buf = bufs[next_buf++ % 8];
  buf[0] = 0;
  const int sigs[] = {SIGHUP, SIGINT, SIGKILL, SIGUSR1, SIGUSR2, SIGTERM, SIGSTOP};
  const char *n[] = {"HUP", "INT", "KILL", "USR1", "USR2", "TERM", "STOP"};
  for (unsigned i = 0; i < sizeof sigs / sizeof sigs[0]; i++) {
    if (sigismember(s, sigs[i]) == 1) {
      if (buf[0]) strcat(buf, ",");
      strcat(buf, n[i]);
    }
  }
  return buf[0] ? buf : "-";
}

static const char *mask(void) {
  sigset_t cur;
  sigemptyset(&cur);
  if (sigprocmask(SIG_BLOCK, NULL, &cur) != 0) return "error";
  return names(&cur);
}

static const char *pending(void) {
  sigset_t p;
  sigemptyset(&p);
  if (sigpending(&p) != 0) {
    char *e = bufs[next_buf++ % 8];
    snprintf(e, 128, "-1 %s", strerror(errno));
    return e;
  }
  return names(&p);
}

static void one(sigset_t *s, int sig) {
  sigemptyset(s);
  sigaddset(s, sig);
}

static pthread_mutex_t mu = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t cv = PTHREAD_COND_INITIALIZER;
static int stage;

static void wait_stage(int n) {
  pthread_mutex_lock(&mu);
  while (stage < n) pthread_cond_wait(&cv, &mu);
  pthread_mutex_unlock(&mu);
}

static void set_stage(int n) {
  pthread_mutex_lock(&mu);
  stage = n;
  pthread_cond_broadcast(&cv);
  pthread_mutex_unlock(&mu);
}

static void *worker(void *arg) {
  (void)arg;
  in_thread = 1;
  sigset_t s;
  one(&s, SIGUSR1);
  pthread_sigmask(SIG_BLOCK, &s, NULL);
  set_stage(1);
  wait_stage(2);
  printf("thread: blocked usr1=%d pending=%s mask=%s\n", usr1, pending(), mask());
  pthread_sigmask(SIG_UNBLOCK, &s, NULL);
  printf("thread: unblocked usr1=%d in_thread=%d pending=%s\n", usr1, usr1_in_thread, pending());
  return NULL;
}

static int show(void) {
  printf("exec: mask=%s\n", mask());
  return 0;
}

int main(int argc, char **argv) {
  if (argc > 1 && strcmp(argv[1], "show") == 0) return show();
  setvbuf(stdout, NULL, _IONBF, 0);
  uint64_t probe = 0;
  printf("kernel sigmask: %s\n", __slicc_sigmask_set(SIG_BLOCK, 0, 0, (int32_t)(uintptr_t)&probe) == ENOSYS ? "no" : "yes");

  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_handler = on_usr1;
  sigaction(SIGUSR1, &sa, NULL);

  printf("start: mask=%s pending=%s\n", mask(), pending());

  sigset_t s, old;
  one(&s, SIGUSR1);
  sigprocmask(SIG_BLOCK, &s, NULL);
  kill(getpid(), SIGUSR1);
  printf("blocked: usr1=%d pending=%s mask=%s\n", usr1, pending(), mask());
  sigprocmask(SIG_UNBLOCK, &s, NULL);
  printf("unblocked: usr1=%d pending=%s mask=%s\n", usr1, pending(), mask());

  sigemptyset(&s);
  sigaddset(&s, SIGKILL);
  sigaddset(&s, SIGSTOP);
  sigaddset(&s, SIGUSR2);
  sigprocmask(SIG_SETMASK, &s, NULL);
  printf("kill/stop: mask=%s\n", mask());
  one(&s, SIGTERM);
  sigemptyset(&old);
  sigprocmask(SIG_BLOCK, &s, &old);
  printf("old: %s now=%s\n", names(&old), mask());
  sigemptyset(&s);
  sigprocmask(SIG_SETMASK, &s, &old);
  printf("cleared: old=%s now=%s\n", names(&old), mask());
  printf("bad how: %s\n", strerror(pthread_sigmask(7, &s, NULL)));

  usr1 = 0;
  pthread_t t;
  pthread_create(&t, NULL, worker, NULL);
  wait_stage(1);
  pthread_kill(t, SIGUSR1);
  usleep(100000);
  printf("main: usr1=%d pending=%s\n", usr1, pending());
  set_stage(2);
  pthread_join(t, NULL);

  one(&s, SIGUSR2);
  sigprocmask(SIG_SETMASK, &s, NULL);
  pid_t p = fork();
  if (p == 0) {
    printf("child: mask=%s\n", mask());
    fflush(stdout);
    execlp("r28", "r28", "show", (char *)NULL);
    printf("exec: -1 %s\n", strerror(errno));
    _exit(3);
  }
  int st = 0;
  waitpid(p, &st, 0);
  printf("parent: child exit=%d\n", WIFEXITED(st) ? WEXITSTATUS(st) : -1);
  printf("r28 done\n");
  return 0;
}
