// wasix-sysroot 2025.9.30-19 probe: raise() reaches the handler, alarm() is
// one-shot, setitimer() ticks and cancels, nanosleep() interrupted by a
// signal (`r19 sleep`, killed from bash) returns EINTR with the time left. `r19 hold` installs dispositions
// and waits, so test/r19.mjs can read them from /proc/<pid>/status.
// One line per result; test/r19.mjs checks them.
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

static volatile sig_atomic_t usr1, alrm;
static void on_usr1(int sig) { (void)sig; usr1++; }
static void on_alrm(int sig) { (void)sig; alrm++; }

static long now_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

// Signals arrive after a kernel call: wait in small sleeps.
static void wait_ms(long ms) {
  long end = now_ms() + ms;
  while (now_ms() < end) usleep(5000);
}

static void timer(long value_ms, long interval_ms) {
  struct itimerval it = {
      .it_value = {value_ms / 1000, (value_ms % 1000) * 1000},
      .it_interval = {interval_ms / 1000, (interval_ms % 1000) * 1000},
  };
  if (setitimer(ITIMER_REAL, &it, NULL) != 0) printf("setitimer failed errno=%d\n", errno);
}

int main(int argc, char **argv) {
  setvbuf(stdout, NULL, _IOLBF, 0);
  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_handler = on_usr1;
  sigaction(SIGUSR1, &sa, NULL);
  sa.sa_handler = on_alrm;
  sigaction(SIGALRM, &sa, NULL);

  if (argc > 1 && !strcmp(argv[1], "sleep")) {
    // test/r19.mjs sends SIGUSR1 from bash after 0.5 s.
    struct timespec req = {3, 0}, rem = {0, 0};
    errno = 0;
    int n = nanosleep(&req, &rem);
    int e = errno;
    long left = rem.tv_sec * 1000 + rem.tv_nsec / 1000000;
    wait_ms(100);
    printf("nanosleep kill: rc=%d errno=%s rem=%s hits=%d\n", n, e == EINTR ? "EINTR" : strerror(e),
           left >= 2000 && left <= 2800 ? "~2.5s" : "off", (int)usr1);
    return 0;
  }
  if (argc > 1 && !strcmp(argv[1], "hold")) {
    // SigCgt: USR1, ALRM, TERM (reset on delivery); SigIgn: USR2.
    signal(SIGUSR2, SIG_IGN);
    sa.sa_handler = on_usr1;
    sa.sa_flags = SA_RESETHAND;
    sigaction(SIGTERM, &sa, NULL);
    printf("holding\n");
    wait_ms(3000);
    return 0;
  }

  int r = raise(SIGUSR1);
  wait_ms(300);
  printf("raise: rc=%d hits=%d\n", r, (int)usr1);

  long t0 = now_ms();
  alarm(1);
  while (!alrm && now_ms() - t0 < 3000) usleep(5000);
  long fired = now_ms() - t0;
  wait_ms(1500);
  printf("alarm 1: fired=%s count=%d\n", fired >= 900 && fired < 1600 ? "~1s" : "off", (int)alrm);

  alrm = 0;
  timer(200, 100);
  wait_ms(650);
  int ticks = alrm;
  timer(0, 0);
  wait_ms(400);
  printf("setitimer 200+100ms: ticks=%s after-cancel=%d\n", ticks >= 3 && ticks <= 6 ? "3..6" : "off", (int)alrm - ticks);

  alrm = 0;
  timer(200, 0);
  struct timespec req = {2, 0}, rem = {0, 0};
  errno = 0;
  int n = nanosleep(&req, &rem);
  int e = errno;
  long left = rem.tv_sec * 1000 + rem.tv_nsec / 1000000;
  printf("nanosleep timer: rc=%d errno=%s rem=%s alrm=%d\n", n, e == EINTR ? "EINTR" : strerror(e),
         left >= 1500 && left <= 1850 ? "~1.8s" : "off", (int)alrm);
  printf("r19 done\n");
  return 0;
}
