/*
 * execve for Emscripten programs running in slicc: the program runs through
 * slicc_spawn.c with this process's fds 0/1/2 as its stdio, and then this
 * process exits with its status, as if it had been replaced by the program.
 * With slicc_fork.c that is also what a forked child that execs does -- except
 * in the wasm realm, where such a child ends at once and its pid stands for
 * the running program (slicc-fork.js), so pipeline stages run concurrently.
 *
 * A kernel with `Module.sliccKernel.execve` (slicc-kernel#99) runs the program
 * as this process's new image under this process's pid, so its getpid(), $$,
 * /proc and ps agree; older kernels get the spawn + execWait path, where the
 * image reports a pid of its own.
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

// The kernel's exec: the wait status of `path` run as this process's new
// image, -errno when it cannot start, or NO_KERNEL_EXEC on older kernels.
#define NO_KERNEL_EXEC (-0x40000000)

EM_JS(int, slicc_execve_js, (const char *path, char *const *argv, char *const *envp), {
  const k = Module.sliccKernel;
  if (!k || typeof k.execve !== 'function') return -0x40000000;
  const strings = (ptr) => {
    const out = [];
    for (let i = 0; ptr; i++) {
      const s = HEAPU32[(ptr >> 2) + i];
      if (!s) break;
      out.push(UTF8ToString(s));
    }
    return out;
  };
  const file = UTF8ToString(path);
  // No program to run is ENOENT, as in slicc_spawn.c.
  if (!file) return -44;
  let env = null;
  if (envp) {
    env = {};
    for (const kv of strings(envp)) {
      const eq = kv.indexOf('=');
      if (eq > 0) env[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
  }
  return k.execve(file, strings(argv), env, null);
});

// In-process fork emulation (slicc-fork.js without a kernel fork): its
// children detach instead of waiting, so they keep the spawn path.
EM_JS(int, slicc_in_emulated_fork, (void), {
  return typeof SliccFork !== 'undefined' && SliccFork.stack.length > 0 ? 1 : 0;
});

// As exec does: caught signals go back to their default action (ignored ones
// stay ignored), so the image left waiting runs no handler of its own. With
// `saved`, the old actions are kept there for restore_handlers.
static void reset_handlers(struct sigaction *saved) {
  for (int sig = 1; sig < _NSIG; sig++) {
    struct sigaction sa;
    if (sigaction(sig, NULL, &sa) != 0) continue;
    if (saved) saved[sig] = sa;
    if ((sa.sa_flags & SA_SIGINFO) || (sa.sa_handler != SIG_DFL && sa.sa_handler != SIG_IGN)) {
      signal(sig, SIG_DFL);
    }
  }
}

static void restore_handlers(const struct sigaction *saved) {
  for (int sig = 1; sig < _NSIG; sig++) sigaction(sig, &saved[sig], NULL);
}

static _Noreturn void exit_as(int status) {
  _exit(WIFSIGNALED(status) ? 128 + WTERMSIG(status) : WEXITSTATUS(status));
}

// wasm-bash's job control (jobs-parent-terminal.patch): a ^C, ^\ or ^Z
// that reached the forked child before it could act on it -- recorded by
// the shell's recorder, or seen by its own SIGINT handler (interrupt_state)
// -- belongs to the program about to start. Weak: only bash defines them.
extern volatile sig_atomic_t slicc_fork_tty_sig __attribute__((weak));
extern volatile sig_atomic_t interrupt_state __attribute__((weak));

static void pending_tty_signal(void) {
  int sig = 0;
  if (&slicc_fork_tty_sig && slicc_fork_tty_sig) {
    sig = slicc_fork_tty_sig;
    slicc_fork_tty_sig = 0;
  } else if (&interrupt_state && interrupt_state) {
    sig = SIGINT;
    interrupt_state = 0;
  }
  if (sig) {
    signal(sig, SIG_DFL);
    kill(-getpgrp(), sig);  // through the kernel: its default action
  }
}

int execve(const char *path, char *const argv[], char *const envp[]) {
  pending_tty_signal();
  if (!slicc_in_emulated_fork()) {
    // Handlers go to their defaults before the image is replaced; a program
    // that cannot start leaves the caller as it was.
    static struct sigaction saved[_NSIG];
    reset_handlers(saved);
    int status = slicc_execve_js(path, argv, envp);
    if (status >= 0) exit_as(status);
    restore_handlers(saved);
    if (status != NO_KERNEL_EXEC) {
      errno = -status;
      return -1;
    }
  }
  int pid = slicc_spawn_capture(path, argv, envp, NULL, 0, 1, 2);
  if (pid < 0) {
    errno = -pid;
    return -1;
  }
  if (slicc_exec_detach(pid)) _exit(0);
  reset_handlers(NULL);
  int status = slicc_exec_wait_js(pid);
  if (status < 0) {
    status = 0;
    waitpid(pid, &status, 0);
  }
  exit_as(status);
}
