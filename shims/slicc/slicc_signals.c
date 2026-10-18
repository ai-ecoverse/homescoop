/*
 * Signals for Emscripten programs in slicc's wasm realm (#3530).
 *
 * The kernel keeps a caught signal pending until the program's next syscall;
 * the runtime then calls slicc_raise(), which runs the handler through libc's
 * raise(). raise() of a signal whose action is the default (and kill() of the
 * program's own pid) goes to the kernel, which applies it, so a parent's wait
 * sees the signal, not exit(128 + sig); caught and ignored ones stay local.
 * slicc_sig_mask() reports the dispositions, so the kernel applies SIGKILL
 * and every default action itself, even to a busy program. kill() reaches
 * other processes through the kernel.
 */
#include <emscripten.h>
#include <errno.h>
#include <stddef.h>
#include <signal.h>
#include <sys/types.h>
#include <unistd.h>

/* Must match Emscripten musl + libc's __sig_actions[] (emcc 4.0.x / 6.0.x).
 * A stale EM_CACHE with sigset_t { unsigned long __bits[2]; } yields
 * sizeof(sigaction)==20 and every disposition bit is garbage. */
_Static_assert(sizeof(sigset_t) == 128, "sigset_t must be 128-byte musl layout");
_Static_assert(sizeof(struct sigaction) == 140, "sigaction must be 140 bytes");
_Static_assert(offsetof(struct sigaction, sa_flags) == 132, "sa_flags offset");

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

EM_JS(int, slicc_kill_js, (int pid, int sig), {
  if (Module.sliccKernel && Module.sliccKernel.kill) return Module.sliccKernel.kill(pid, sig);
  return 1;
});

EM_JS(int, slicc_pause_js, (void), {
  if (Module.sliccKernel && Module.sliccKernel.pause) return Module.sliccKernel.pause();
  return -52;
});

EM_JS(int, slicc_sig_inherited_js, (void), {
  try {
    if (Module.sliccKernel && typeof Module.sliccKernel.sigInherited === 'function') return Module.sliccKernel.sigInherited() | 0;
  } catch (e) {
  }
  return 0;
});

__attribute__((constructor(101))) static void slicc_seed_inherited_ignores(void) {
  unsigned mask = (unsigned)slicc_sig_inherited_js();
  for (int sig = 1; sig < 32 && sig < _NSIG; sig++) {
    if (!(mask & (1u << sig)) || sig == SIGKILL || sig == SIGSTOP) continue;
    struct sigaction *a = &__sig_actions[sig];
    if (!(a->sa_flags & SA_SIGINFO) && a->sa_handler == SIG_DFL) a->sa_handler = SIG_IGN;
  }
}

static int slicc_default_is_kernels(int sig) {
  if (sig == SIGKILL || sig == SIGSTOP) return 1;
  const struct sigaction *a = &__sig_actions[sig];
  if ((a->sa_flags & SA_SIGINFO) || a->sa_handler != SIG_DFL) return 0;
  return sig != SIGCHLD && sig != SIGCONT && sig != SIGURG && sig != SIGWINCH;
}

int __real_raise(int sig);

static int slicc_raising;

int __wrap_raise(int sig) {
  if (slicc_raising || sig <= 0 || sig >= 32 || sig >= _NSIG || !slicc_default_is_kernels(sig)) return __real_raise(sig);
  slicc_raising = 1;
  int r = slicc_kill_js(getpid(), sig);
  if (r != 0) {
    slicc_raising = 0;
    return __real_raise(sig);
  }
  if (sig == SIGSTOP || sig == SIGTSTP || sig == SIGTTIN || sig == SIGTTOU) {
    slicc_raising = 0;
    return 0;
  }
  while (slicc_pause_js() == -EINTR) {
  }
  _Exit(128 + sig);
}

int kill(pid_t pid, int sig) {
  if (sig < 0 || sig >= _NSIG) {
    errno = EINVAL;
    return -1;
  }
  if (pid == getpid()) return sig ? raise(sig) : 0;
  // A group (0: the caller's, or -pgid) is the kernel's to signal, the caller included.
  int r = slicc_kill_js(pid, sig);
  if (r == 1) {
    // No kernel: the caller is its group's only process.
    if (pid == 0 || pid == -getpid()) return sig ? raise(sig) : 0;
    r = -EPERM;
  }
  if (r < 0) {
    errno = -r;
    return -1;
  }
  return 0;
}

int __syscall_pause(void) { return slicc_pause_js(); }
