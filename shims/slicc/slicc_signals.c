/*
 * Signals for Emscripten programs in slicc's wasm realm (#3530).
 *
 * The kernel keeps a caught signal pending until the program's next syscall;
 * the runtime then calls slicc_raise(), which runs the handler through libc's
 * raise() (or the default action, _Exit(128 + sig), when the program changed
 * its disposition meanwhile). slicc_sig_mask() reports the dispositions, so
 * the kernel applies SIGKILL and every default action itself, even to a busy
 * program. kill() reaches other processes through the kernel.
 */
#include <emscripten.h>
#include <errno.h>
#include <signal.h>
#include <sys/types.h>
#include <unistd.h>

extern struct sigaction __sig_actions[_NSIG];

EMSCRIPTEN_KEEPALIVE void slicc_raise(int sig) { raise(sig); }

// Bit n set for signal n: `which` 0 = caught, 1 = ignored, 2 = caught with SA_RESTART.
EMSCRIPTEN_KEEPALIVE int slicc_sig_mask(int which) {
  int mask = 0;
  for (int sig = 1; sig < 32 && sig < _NSIG; sig++) {
    const struct sigaction *a = &__sig_actions[sig];
    int info = a->sa_flags & SA_SIGINFO;
    int caught = info || (a->sa_handler != SIG_DFL && a->sa_handler != SIG_IGN);
    int ignored = !info && a->sa_handler == SIG_IGN;
    int bit = which == 0 ? caught : which == 1 ? ignored : caught && (a->sa_flags & SA_RESTART);
    if (bit) mask |= 1 << sig;
  }
  return mask;
}

// 0, or -errno. Outside the wasm realm only a process's own pid works.
EM_JS(int, slicc_kill_js, (int pid, int sig), {
  if (Module.sliccKernel && Module.sliccKernel.kill) return Module.sliccKernel.kill(pid, sig);
  return -63; // EPERM (WASI numbering)
});

int kill(pid_t pid, int sig) {
  if (sig < 0 || sig >= _NSIG) {
    errno = EINVAL;
    return -1;
  }
  if (pid == getpid() || pid == 0) return sig ? raise(sig) : 0;
  int r = slicc_kill_js(pid, sig);
  if (r < 0) {
    errno = -r;
    return -1;
  }
  return 0;
}
