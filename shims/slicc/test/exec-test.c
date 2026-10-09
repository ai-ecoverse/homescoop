/*
 * exec through slicc_exec.c keeps the pid (slicc-kernel#176):
 *   exec-test N          prints "L<N> <getpid()> <readlink /proc/self>" and,
 *                        while N > 0, execs itself (execvp, by name) with N-1
 *   exec-test N fork     forks; the child execs `<self> N`, the parent prints
 *                        "child <pid>" and exits with the child's status
 * Built twice: with the `cli` shim profile (most packages) and with `fork`
 * (bash, tar, findutils: fork emulation + Asyncify).
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

static void show(int n) {
  char self[64];
  ssize_t len = readlink("/proc/self", self, sizeof self - 1);
  self[len < 0 ? 0 : len] = '\0';
  printf("L%d %d %s\n", n, (int)getpid(), self);
  fflush(stdout);
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: exec-test N [fork]\n");
    return 64;
  }
  const char *self = strrchr(argv[0], '/') ? strrchr(argv[0], '/') + 1 : argv[0];
  int n = atoi(argv[1]);
  if (argc > 2 && !strcmp(argv[2], "fork")) {
    pid_t pid = fork();
    if (pid < 0) {
      perror("fork");
      return 1;
    }
    if (pid == 0) {
      execlp(self, self, argv[1], (char *)NULL);
      perror("execlp");
      _exit(127);
    }
    printf("child %d\n", (int)pid);
    fflush(stdout);
    int status = 0;
    if (waitpid(pid, &status, 0) != pid) {
      perror("waitpid");
      return 1;
    }
    return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
  }
  show(n);
  if (n > 0) {
    char next[16];
    snprintf(next, sizeof next, "%d", n - 1);
    execlp(self, self, next, (char *)NULL);
    perror("execlp");
    return 127;
  }
  return 0;
}
