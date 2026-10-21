/*
 * posix_spawn file actions and the environment, through slicc_spawn.c and
 * slicc-env.js (homescoop#1302, #612):
 *   spawn-test fa r|w PATH   spawn itself with fd 0 (r) or 1 (w) opened on PATH;
 *                            prints "fa <errno name>" (0 when it ran)
 *   spawn-test env-i         spawn itself with an empty environment ("env")
 *   spawn-test env           print the environment, one entry per line
 *   spawn-test child         print "child ran"
 */
#include <errno.h>
#include <fcntl.h>
#include <spawn.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

static const char *name(int e) {
  switch (e) {
    case 0: return "0";
    case ENOENT: return "ENOENT";
    case EACCES: return "EACCES";
    case ENOTDIR: return "ENOTDIR";
    case EISDIR: return "EISDIR";
    default: return strerror(e);
  }
}

static int run(char *const argv[], char *const envp[], posix_spawn_file_actions_t *fa) {
  pid_t pid;
  int r = posix_spawnp(&pid, "spawn-test", fa, NULL, argv, envp);
  if (r == 0) {
    int st;
    if (waitpid(pid, &st, 0) != pid || !WIFEXITED(st) || WEXITSTATUS(st) != 0) return -1;
  }
  return r;
}

int main(int argc, char **argv) {
  if (argc >= 2 && strcmp(argv[1], "child") == 0) {
    printf("child ran\n");
    return 0;
  }
  if (argc >= 2 && strcmp(argv[1], "env") == 0) {
    for (char **e = environ; *e; e++) printf("%s\n", *e);
    return 0;
  }
  if (argc >= 2 && strcmp(argv[1], "env-i") == 0) {
    char *cargv[] = {"spawn-test", "env", NULL};
    char *cenv[] = {NULL};
    fflush(stdout);
    int r = run(cargv, cenv, NULL);
    if (r != 0) fprintf(stderr, "spawn-test: env-i: %d\n", r);
    return r != 0;
  }
  if (argc == 4 && strcmp(argv[1], "fa") == 0) {
    int write = strcmp(argv[2], "w") == 0;
    posix_spawn_file_actions_t fa;
    posix_spawn_file_actions_init(&fa);
    posix_spawn_file_actions_addopen(&fa, write ? 1 : 0, argv[3], write ? O_WRONLY | O_CREAT | O_TRUNC : O_RDONLY, 0644);
    char *cargv[] = {"spawn-test", "child", NULL};
    fflush(stdout);
    int r = run(cargv, environ, &fa);
    posix_spawn_file_actions_destroy(&fa);
    printf("fa %s\n", r < 0 ? "child failed" : name(r));
    return 0;
  }
  fprintf(stderr, "usage: spawn-test fa r|w PATH | env-i | env | child\n");
  return 64;
}
