// wasix-sysroot 2025.9.30-19 probe: raise() reaches the handler, alarm() is
// one-shot, setitimer() ticks and cancels, nanosleep() interrupted by a
// signal (`r19 sleep`, killed from bash) returns EINTR with the time left. `r19 hold` installs dispositions
// and waits, so test/r19.mjs can read them from /proc/<pid>/status.
// One line per result; test/r19.mjs checks them.
#include <errno.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

static volatile sig_atomic_t usr1, alrm, vtalrm, prof;
static void on_usr1(int sig) { (void)sig; usr1++; }
static void on_alrm(int sig) { (void)sig; alrm++; }
static void on_vtalrm(int sig) { (void)sig; vtalrm++; }
static void on_prof(int sig) { (void)sig; prof++; }

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

static void timer_of(int which, long value_ms, long interval_ms) {
  struct itimerval it = {
      .it_value = {value_ms / 1000, (value_ms % 1000) * 1000},
      .it_interval = {interval_ms / 1000, (interval_ms % 1000) * 1000},
  };
  if (setitimer(which, &it, NULL) != 0) printf("setitimer failed errno=%d\n", errno);
}

static void timer(long value_ms, long interval_ms) { timer_of(ITIMER_REAL, value_ms, interval_ms); }

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
  if (argc > 1 && !strcmp(argv[1], "sleep3")) {
    // test/r19.mjs sends SIGUSR1 from bash after 0.5 s: 2.5 s left, and
    // sleep() returns the whole seconds of it, as musl does.
    printf("sleep 3 killed: returns %u hits=%d\n", sleep(3), (int)usr1);
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

  usr1 = 0;
  int pk = pthread_kill(pthread_self(), SIGUSR1);
  wait_ms(300);
  printf("pthread_kill self: rc=%d hits=%d\n", pk, (int)usr1);

  // Only ITIMER_REAL: no CPU-time clocks, so VIRTUAL and PROF fail.
  sa.sa_handler = on_vtalrm;
  sigaction(SIGVTALRM, &sa, NULL);
  sa.sa_handler = on_prof;
  sigaction(SIGPROF, &sa, NULL);
  struct itimerval cpu = {{0, 0}, {0, 100000}};
  errno = 0;
  int v = setitimer(ITIMER_VIRTUAL, &cpu, NULL);
  int ve = errno;
  errno = 0;
  int pr = setitimer(ITIMER_PROF, &cpu, NULL);
  int pe = errno;
  wait_ms(400);
  printf("setitimer virtual/prof: %d %s %d %s vtalrm=%d prof=%d alrm=%d\n", v, ve == EINVAL ? "EINVAL" : strerror(ve),
         pr, pe == EINVAL ? "EINVAL" : strerror(pe), (int)vtalrm, (int)prof, (int)alrm);

  // getitimer and setitimer's old value report what is left.
  struct itimerval cur, prev;
  timer(2000, 0);
  wait_ms(500);
  int g = getitimer(ITIMER_REAL, &cur);
  long gl = cur.it_value.tv_sec * 1000 + cur.it_value.tv_usec / 1000;
  struct itimerval off = {{0, 0}, {0, 0}};
  setitimer(ITIMER_REAL, &off, &prev);
  long pl = prev.it_value.tv_sec * 1000 + prev.it_value.tv_usec / 1000;
  getitimer(ITIMER_REAL, &cur);
  printf("getitimer: rc=%d left=%s old=%s after-cancel=%ld\n", g, gl >= 1400 && gl <= 1550 ? "~1.5s" : "off",
         pl >= 1400 && pl <= 1550 ? "~1.5s" : "off", (long)(cur.it_value.tv_sec * 1000000 + cur.it_value.tv_usec));
  unsigned a1 = alarm(5);
  wait_ms(100);
  unsigned a2 = alarm(0);
  printf("alarm returns: %u %u\n", a1, a2);

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
