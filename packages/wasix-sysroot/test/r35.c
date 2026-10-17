/* wasix-sysroot -35 probe: a handler runs with its sa_mask and (unless
 * SA_NODEFER) its own signal blocked, and the old mask is back after it
 * (slicc-kernel#975). */
#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static volatile int depth, max_depth, usr1, usr2, usr2_inside;
static char order[64];
static volatile int olen;
static void note(char c) { if (olen < 63) order[olen++] = c; }

static void on_usr2(int sig) { (void)sig; usr2++; note('2'); }
static void on_usr1(int sig) {
  (void)sig;
  depth++;
  if (depth > max_depth) max_depth = depth;
  usr1++;
  note('<');
  if (usr1 == 1) {
    raise(SIGUSR2);           /* in sa_mask: waits until this handler returns */
    usr2_inside = usr2;
    raise(SIGUSR1);           /* itself: waits too, unless SA_NODEFER */
    for (int i = 0; i < 20; i++) usleep(1000);
  }
  note('>');
  depth--;
}

static int blocked(int sig) {
  sigset_t cur;
  sigemptyset(&cur);
  pthread_sigmask(SIG_BLOCK, NULL, &cur);
  return sigismember(&cur, sig) == 1;
}

static void run(const char *label, int flags) {
  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_handler = on_usr1;
  sa.sa_flags = flags;
  sigemptyset(&sa.sa_mask);
  sigaddset(&sa.sa_mask, SIGUSR2);
  sigaction(SIGUSR1, &sa, NULL);
  memset(&sa, 0, sizeof sa);
  sa.sa_handler = on_usr2;
  sigaction(SIGUSR2, &sa, NULL);
  depth = max_depth = usr1 = usr2 = usr2_inside = olen = 0;
  raise(SIGUSR1);
  for (int i = 0; i < 100 && (usr1 < 2 || usr2 < 1); i++) usleep(2000);
  order[olen] = 0;
  printf("%s: usr1=%d usr2=%d usr2_inside=%d max_depth=%d order=%s after: usr1_blocked=%d usr2_blocked=%d\n",
         label, usr1, usr2, usr2_inside, max_depth, order, blocked(SIGUSR1), blocked(SIGUSR2));
}

int main(void) {
  setvbuf(stdout, NULL, _IONBF, 0);
  run("sa_mask USR2", 0);
  run("SA_NODEFER", SA_NODEFER);
  printf("r35 done\n");
  return 0;
}
