/* wasix-sysroot -36 probe (homescoop#1059): sigsetjmp/siglongjmp, plain and
 * out of a signal handler, with and without the saved mask. EH trees only;
 * the asyncify tree ("noeh") has no sigsetjmp. */
#define _GNU_SOURCE
#include <setjmp.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#ifdef __wasm_exception_handling__
static sigjmp_buf jb;
static volatile int hits;
static void jump(int s) { (void)s; hits++; siglongjmp(jb, 7); }

static int blocked(int sig) { sigset_t c; sigemptyset(&c); sigprocmask(SIG_BLOCK, NULL, &c); return sigismember(&c, sig) == 1; }

static void from_handler(int save) {
  struct sigaction sa; memset(&sa, 0, sizeof sa);
  sa.sa_handler = jump; sigemptyset(&sa.sa_mask); sigaddset(&sa.sa_mask, SIGUSR2);
  sigaction(SIGUSR1, &sa, NULL);
  volatile int r = sigsetjmp(jb, save);
  if (r == 0) {
    raise(SIGUSR1);
    printf("handler save=%d: not jumped\n", save);
    return;
  }
  printf("handler save=%d: sigsetjmp=%d hits=%d usr1_blocked=%d usr2_blocked=%d\n", save, r, hits, blocked(SIGUSR1), blocked(SIGUSR2));
  sigset_t none; sigemptyset(&none); sigprocmask(SIG_SETMASK, &none, NULL);
}
#endif

int main(void) {
  setvbuf(stdout, NULL, _IONBF, 0);
#ifdef __wasm_exception_handling__
  volatile int n = 0;
  int r = sigsetjmp(jb, 0);
  if (r == 0) { n++; siglongjmp(jb, 3); }
  printf("plain: sigsetjmp=%d after %d\n", r, n);
  sigset_t s; sigemptyset(&s); sigaddset(&s, SIGUSR2);
  r = sigsetjmp(jb, 1);
  if (r == 0) { sigprocmask(SIG_BLOCK, &s, NULL); siglongjmp(jb, 4); }
  printf("mask restored by siglongjmp: sigsetjmp=%d usr2_blocked=%d\n", r, blocked(SIGUSR2));
  from_handler(1);
  from_handler(0);
#else
  printf("no sigsetjmp in this tree\n");
#endif
  printf("r37 done\n");
  return 0;
}
