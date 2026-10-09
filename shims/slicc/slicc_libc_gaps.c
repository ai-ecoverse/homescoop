/*
 * Functions Emscripten's libc declares but does not define. Link into GNU
 * tools whose feature checks cannot see the gap (Emscripten's configure mode
 * tolerates undefined symbols).
 */
#include <emscripten.h>
#include <errno.h>
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

// Who the program runs as: an ordinary user, never root. Emscripten answers 0
// (real, effective and saved ids alike), so bash -- which reads them with
// getresuid/getresgid -- showed a `#` prompt and programs took root-only paths.
#include <unistd.h>
#include <grp.h>
#define SLICC_UID 1000
uid_t __syscall_getuid32(void) { return SLICC_UID; }
uid_t __syscall_geteuid32(void) { return SLICC_UID; }
gid_t __syscall_getgid32(void) { return SLICC_UID; }
gid_t __syscall_getegid32(void) { return SLICC_UID; }
int __syscall_getresuid32(uid_t *ruid, uid_t *euid, uid_t *suid) {
  *ruid = *euid = *suid = SLICC_UID;
  return 0;
}
int __syscall_getresgid32(gid_t *rgid, gid_t *egid, gid_t *sgid) {
  *rgid = *egid = *sgid = SLICC_UID;
  return 0;
}

// Emscripten musl routes every set*id through __setxid_emscripten() which
// always returns EPERM (and drops the ids). Provide strong POSIX setters for
// an unprivileged process whose real = effective = saved id is SLICC_UID so
// screen/bash/su-like code can "drop privileges" to itself.
static int slicc_id_ok(int id) {
  return id == -1 || id == (int)SLICC_UID;
}

static int slicc_set_one(int id) {
  if (id == (int)SLICC_UID) return 0;
  errno = EPERM;
  return -1;
}

int setuid(uid_t uid) { return slicc_set_one((int)uid); }
int seteuid(uid_t euid) { return slicc_set_one((int)euid); }
int setgid(gid_t gid) { return slicc_set_one((int)gid); }
int setegid(gid_t egid) { return slicc_set_one((int)egid); }

int setreuid(uid_t ruid, uid_t euid) {
  if (slicc_id_ok((int)ruid) && slicc_id_ok((int)euid)) return 0;
  errno = EPERM;
  return -1;
}

int setregid(gid_t rgid, gid_t egid) {
  if (slicc_id_ok((int)rgid) && slicc_id_ok((int)egid)) return 0;
  errno = EPERM;
  return -1;
}

int setresuid(uid_t ruid, uid_t euid, uid_t suid) {
  if (slicc_id_ok((int)ruid) && slicc_id_ok((int)euid) && slicc_id_ok((int)suid))
    return 0;
  errno = EPERM;
  return -1;
}

int setresgid(gid_t rgid, gid_t egid, gid_t sgid) {
  if (slicc_id_ok((int)rgid) && slicc_id_ok((int)egid) && slicc_id_ok((int)sgid))
    return 0;
  errno = EPERM;
  return -1;
}

int setgroups(size_t size, const gid_t *list) {
  if (size == 0) return 0;
  if (!list) {
    errno = EFAULT;
    return -1;
  }
  for (size_t i = 0; i < size; i++) {
    if (list[i] != (gid_t)SLICC_UID) {
      errno = EPERM;
      return -1;
    }
  }
  return 0;
}

// Emscripten has no sethostname. The realm user is not root, so setting the
// host name (coreutils `hostname NAME`) is refused, as on Linux.
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
