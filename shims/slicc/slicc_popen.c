/*
 * system / popen / pclose for Emscripten tools in slicc.
 *
 * Stock emscripten ships ENOSYS stubs for popen/pclose, and system() jumps to
 * `_emscripten_system` which returns -ENOSYS outside Node. Musl's real
 * popen/system use posix_spawn, but the stubs win the link unless we provide
 * our own (same class of bug as libstubs execve).
 *
 * Route through slicc posix_spawn (slicc_spawn.c) so gawk pipes, sed `e`,
 * and system() work without fork/ASYNCIFY.
 */
#include <errno.h>
#include <fcntl.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

#define SLICC_MAX_PIPES 32

static struct {
  FILE *fp;
  pid_t pid;
} slicc_pipes[SLICC_MAX_PIPES];

static int slicc_pipe_slot(FILE *fp) {
  for (int i = 0; i < SLICC_MAX_PIPES; i++) {
    if (slicc_pipes[i].fp == fp)
      return i;
  }
  return -1;
}

static int slicc_pipe_alloc(FILE *fp, pid_t pid) {
  for (int i = 0; i < SLICC_MAX_PIPES; i++) {
    if (!slicc_pipes[i].fp) {
      slicc_pipes[i].fp = fp;
      slicc_pipes[i].pid = pid;
      return i;
    }
  }
  return -1;
}

int system(const char *cmd) {
  if (!cmd)
    return 1;

  pid_t pid;
  int status = -1;
  char *argv[] = {"sh", "-c", (char *)cmd, NULL};
  int ret = posix_spawn(&pid, "/bin/sh", NULL, NULL, argv, environ);
  if (ret) {
    errno = ret;
    return -1;
  }
  while (waitpid(pid, &status, 0) < 0) {
    if (errno != EINTR)
      return -1;
  }
  return status;
}

FILE *popen(const char *cmd, const char *mode) {
  if (!cmd || !mode || (mode[0] != 'r' && mode[0] != 'w')) {
    errno = EINVAL;
    return NULL;
  }

  int p[2];
  if (pipe(p) < 0)
    return NULL;

  /* mode 'r': parent reads p[0], child writes p[1] as stdout.
   * mode 'w': parent writes p[1], child reads p[0] as stdin. */
  int parent_fd = mode[0] == 'r' ? p[0] : p[1];
  int child_fd = mode[0] == 'r' ? p[1] : p[0];
  int child_std = mode[0] == 'r' ? STDOUT_FILENO : STDIN_FILENO;

  posix_spawn_file_actions_t fa;
  if (posix_spawn_file_actions_init(&fa) != 0) {
    close(p[0]);
    close(p[1]);
    return NULL;
  }
  if (posix_spawn_file_actions_adddup2(&fa, child_fd, child_std) != 0 ||
      posix_spawn_file_actions_addclose(&fa, p[0]) != 0 ||
      posix_spawn_file_actions_addclose(&fa, p[1]) != 0) {
    posix_spawn_file_actions_destroy(&fa);
    close(p[0]);
    close(p[1]);
    return NULL;
  }

  pid_t pid;
  char *argv[] = {"sh", "-c", (char *)cmd, NULL};
  int ret = posix_spawn(&pid, "/bin/sh", &fa, NULL, argv, environ);
  posix_spawn_file_actions_destroy(&fa);
  close(child_fd);
  if (ret != 0) {
    close(parent_fd);
    errno = ret;
    return NULL;
  }

  FILE *fp = fdopen(parent_fd, mode);
  if (!fp) {
    close(parent_fd);
    /* Best-effort reap; child may still be running. */
    int st;
    waitpid(pid, &st, 0);
    return NULL;
  }
  if (slicc_pipe_alloc(fp, pid) < 0) {
    fclose(fp);
    int st;
    waitpid(pid, &st, 0);
    errno = EMFILE;
    return NULL;
  }
  return fp;
}

int pclose(FILE *fp) {
  int slot = slicc_pipe_slot(fp);
  if (slot < 0) {
    errno = EINVAL;
    return -1;
  }
  pid_t pid = slicc_pipes[slot].pid;
  slicc_pipes[slot].fp = NULL;
  slicc_pipes[slot].pid = 0;

  if (fclose(fp) != 0) {
    /* Still wait so we do not leave a zombie. */
  }
  int status = -1;
  while (waitpid(pid, &status, 0) < 0) {
    if (errno != EINTR)
      return -1;
  }
  return status;
}
