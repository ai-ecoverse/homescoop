/*
 * execve for Emscripten programs running in slicc: the program runs through
 * slicc_spawn.c with this process's fds 0/1/2 as its stdio, and then this
 * process exits with its status, as if it had been replaced by the program.
 * With slicc_fork.c that is also what a forked child that execs does -- except
 * in the wasm realm, where such a child ends at once and its pid stands for
 * the running program (slicc-fork.js), so pipeline stages run concurrently.
 * Link with slicc_spawn.c.
 */
#include <errno.h>
#include <sys/types.h>
#include <emscripten.h>
#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>

int slicc_spawn_capture(const char *file, char *const *argv, char *const *envp, const char *cwd,
                        int in_fd, int out_fd, int err_fd);
int slicc_exec_detach(int pid);

// The wasm realm's exec wait: signals sent to this process go to the program
// while it runs. Its wait status, or -1 outside the wasm realm.
EM_JS(int, slicc_exec_wait_js, (int pid), {
  if (!Module.sliccKernel || !Module.sliccKernel.execWait) return -1;
  return Module.sliccKernel.execWait(pid);
});

// As exec does: caught signals go back to their default action (ignored ones
// stay ignored), so the image left waiting runs no handler of its own.
static void reset_handlers(void) {
  for (int sig = 1; sig < _NSIG; sig++) {
    struct sigaction sa;
    if (sigaction(sig, NULL, &sa) != 0) continue;
    if ((sa.sa_flags & SA_SIGINFO) || (sa.sa_handler != SIG_DFL && sa.sa_handler != SIG_IGN)) {
      signal(sig, SIG_DFL);
    }
  }
}

int execve(const char *path, char *const argv[], char *const envp[]) {
  int pid = slicc_spawn_capture(path, argv, envp, NULL, 0, 1, 2);
  if (pid < 0) {
    errno = -pid;
    return -1;
  }
  if (slicc_exec_detach(pid)) _exit(0);
  reset_handlers();
  int status = slicc_exec_wait_js(pid);
  if (status < 0) {
    status = 0;
    waitpid(pid, &status, 0);
  }
  _exit(WIFSIGNALED(status) ? 128 + WTERMSIG(status) : WEXITSTATUS(status));
}
