#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void on_term(int sig) { printf("handler %d\n", sig); }

int main(int argc, char **argv) {
  const char *m = argc > 1 ? argv[1] : "";
  setvbuf(stdout, NULL, _IONBF, 0);
  if (!strcmp(m, "kill-term")) kill(getpid(), SIGTERM);
  else if (!strcmp(m, "raise-term")) raise(SIGTERM);
  else if (!strcmp(m, "raise-kill")) raise(SIGKILL);
  else if (!strcmp(m, "trap")) {
    signal(SIGTERM, on_term);
    kill(getpid(), SIGTERM);
  } else if (!strcmp(m, "ignore")) {
    signal(SIGTERM, SIG_IGN);
    raise(SIGTERM);
  } else if (!strcmp(m, "chld")) raise(SIGCHLD);
  else if (!strcmp(m, "exit-143")) exit(143);
  printf("survived %s\n", m);
  return 0;
}
