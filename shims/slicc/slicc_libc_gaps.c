/*
 * Functions Emscripten's libc declares but does not define. Link into GNU
 * tools whose feature checks cannot see the gap (Emscripten's configure mode
 * tolerates undefined symbols).
 */
#include <emscripten.h>
#include <errno.h>
#include <stdint.h>
#include <fcntl.h>
#include <sys/types.h>
#include <time.h>

// grep uses splice() to drain input to /dev/null when SPLICE_F_MOVE is
// defined (musl defines it); EINVAL makes it fall back to read().
ssize_t splice(int fd_in, off_t *off_in, int fd_out, off_t *off_out, size_t len, unsigned flags) {
  errno = EINVAL;
  return -1;
}

// Sleeping: Emscripten's single-threaded libc sleeps by spinning. A program
// here always runs in a worker (the wasm realm's, or a node realm's), where
// Atomics.wait blocks without burning a core. Without SharedArrayBuffer, spin.
EM_JS(void, slicc_sleep_ms, (double ms), {
  if (typeof SharedArrayBuffer === 'function' && typeof Atomics === 'object') {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    return;
  }
  const end = Date.now() + ms;
  while (Date.now() < end) {}
});

static double timespec_ms(const struct timespec *t) {
  return (double)t->tv_sec * 1000.0 + (double)t->tv_nsec / 1e6;
}

int clock_nanosleep(clockid_t clk, int flags, const struct timespec *req, struct timespec *rem) {
  if (!req || req->tv_nsec < 0 || req->tv_nsec >= 1000000000L) return EINVAL;
  double ms = timespec_ms(req);
  if (flags & TIMER_ABSTIME) {
    struct timespec now;
    clock_gettime(clk, &now);
    ms -= timespec_ms(&now);
  }
  if (ms > 0) slicc_sleep_ms(ms);
  if (rem) rem->tv_sec = rem->tv_nsec = 0;
  return 0;
}

int nanosleep(const struct timespec *req, struct timespec *rem) {
  int r = clock_nanosleep(CLOCK_REALTIME, 0, req, rem);
  if (r) {
    errno = r;
    return -1;
  }
  return 0;
}

// The wasm realm asks this on a write to a pipe with no reader (#3530): 1 when
// SIGPIPE is ignored or handled -- a handler has then run, and the write fails
// with EPIPE -- or 0 when the signal's default action ends the program.
#include <signal.h>
EMSCRIPTEN_KEEPALIVE int slicc_sigpipe(void) {
  struct sigaction sa;
  if (sigaction(SIGPIPE, NULL, &sa) != 0 || sa.sa_handler == SIG_DFL) return 0;
  if (sa.sa_handler != SIG_IGN) raise(SIGPIPE);
  return 1;
}

#ifndef SLICC_CRED_SEPARATE
#include "slicc_cred.c"
#endif

// Emscripten has no sethostname. Setting the host name (coreutils
// `hostname NAME`) is refused, as for a user without CAP_SYS_ADMIN.
int sethostname(const char *name, size_t len) {
  (void)name;
  (void)len;
  errno = EPERM;
  return -1;
}

// Default-linked programs need real pids from the wasm realm. Emscripten's
// stubs answer getpid()=42 / getppid()=1. Weak so slicc_fork.c (ASYNCIFY
// fork link) can override with its strong __syscall_getpid/getppid.
EM_JS(int, slicc_default_getpid_js, (void), {
  return (Module.sliccPid | 0) || 42;
});
EM_JS(int, slicc_default_getppid_js, (void), {
  return (Module.sliccPpid | 0) || 1;
});
__attribute__((weak)) pid_t __syscall_getpid(void) { return slicc_default_getpid_js(); }
__attribute__((weak)) pid_t __syscall_getppid(void) { return slicc_default_getppid_js(); }

__attribute__((import_module("env"), import_name("__syscall_linkat")))
int slicc_linkat_import(int olddirfd, intptr_t oldpath, int newdirfd, intptr_t newpath, int flags);
int __syscall_linkat(int olddirfd, intptr_t oldpath, int newdirfd, intptr_t newpath, int flags) {
  return slicc_linkat_import(olddirfd, oldpath, newdirfd, newpath, flags);
}

__attribute__((import_module("env"), import_name("__syscall_uname")))
int slicc_uname_import(intptr_t buf);
int __syscall_uname(intptr_t buf) {
  return slicc_uname_import(buf);
}

// Resource limits (homescoop#178). Emscripten's libc answers prlimit64 with a
// stub that refuses every change (EPERM), so `ulimit -S -n 64` failed in bash
// and the kernel never saw the call. Here each process keeps its own limits:
// they start where the stub's answers were (RLIMIT_NOFILE 4096, the size of
// FS.MAX_OPEN_FDS; RLIMIT_STACK the wasm stack; the rest unlimited), and those
// hard limits are what the process really has, so they can be lowered, never
// raised, by root too (EPERM, as Linux for NOFILE beyond nr_open). A soft limit
// may move anywhere up to its hard limit. fork() copies them with the rest of
// memory; an exec starts a new program at the defaults (slicc-kernel keeps no
// limits to pass on). The limits are advisory: nothing enforces them yet.
#include <sys/resource.h>
#include <unistd.h>
#include <emscripten/stack.h>

static struct rlimit slicc_rlimits[RLIM_NLIMITS];
static int slicc_rlimits_ready;

static void slicc_rlimits_init(void) {
  if (slicc_rlimits_ready) return;
  for (int i = 0; i < RLIM_NLIMITS; i++) slicc_rlimits[i].rlim_cur = slicc_rlimits[i].rlim_max = RLIM_INFINITY;
  slicc_rlimits[RLIMIT_NOFILE].rlim_cur = slicc_rlimits[RLIMIT_NOFILE].rlim_max = 4096;
  rlim_t stack = emscripten_stack_get_base() - emscripten_stack_get_end();
  slicc_rlimits[RLIMIT_STACK].rlim_cur = slicc_rlimits[RLIMIT_STACK].rlim_max = stack;
  slicc_rlimits_ready = 1;
}

int __syscall_prlimit64(int pid, int resource, intptr_t new_limit, intptr_t old_limit) {
  if (pid != 0 && pid != getpid()) return -EPERM;
  if (resource < 0 || resource >= RLIM_NLIMITS) return -EINVAL;
  slicc_rlimits_init();
  struct rlimit *cur = &slicc_rlimits[resource];
  struct rlimit want;
  if (new_limit) {
    want = *(const struct rlimit *)new_limit;
    if (want.rlim_cur > want.rlim_max) return -EINVAL;
    if (want.rlim_max > cur->rlim_max) return -EPERM;
  }
  if (old_limit) *(struct rlimit *)old_limit = *cur;
  if (new_limit) *cur = want;
  return 0;
}

// Emscripten's libc leaves out musl's src/linux, so prlimit() itself was
// missing (an undefined symbol at link time).
int prlimit(pid_t pid, int resource, const struct rlimit *new_limit, struct rlimit *old_limit) {
  int r = __syscall_prlimit64(pid, resource, (intptr_t)new_limit, (intptr_t)old_limit);
  if (r < 0) {
    errno = -r;
    return -1;
  }
  return 0;
}
