/*
 * pselect(2) for Emscripten programs in slicc's wasm realm (#3530): when every
 * fd is a kernel descriptor (a pipe, the terminal), the kernel waits for one to
 * be ready, the timeout, or a signal. Elsewhere, and for fds of the program's
 * own FS, it is libc's select (which never blocks under Emscripten).
 *
 * make's jobserver waits in pselect() for a token or SIGCHLD; Emscripten's
 * libc has no pselect6, so `make -jN` failed ("pselect jobs pipe").
 */
#include <emscripten.h>
#include <errno.h>
#include <signal.h>
#include <sys/select.h>
#include <sys/time.h>

// Ready count, -errno, or -1000 when the kernel cannot take these fds.
EM_JS(int, slicc_select_js, (int n, fd_set *rfds, fd_set *wfds, int timeout_ms), {
  const kernel = Module.sliccKernel;
  if (!kernel || !kernel.select) return -1000;
  const bits = (set) => {
    const fds = [];
    if (!set) return fds;
    for (let fd = 0; fd < n; fd++) if (HEAPU32[(set >> 2) + (fd >> 5)] & (1 << (fd & 31))) fds.push(fd);
    return fds;
  };
  const r = kernel.select(bits(rfds), bits(wfds), timeout_ms);
  if (r === null) return -1000;
  if (typeof r === 'number') return r;
  const store = (set, ready) => {
    if (!set) return;
    for (let w = 0; w < ((n + 31) >> 5); w++) HEAPU32[(set >> 2) + w] = 0;
    for (const fd of ready) HEAPU32[(set >> 2) + (fd >> 5)] |= 1 << (fd & 31);
  };
  store(rfds, r.read);
  store(wfds, r.write);
  return r.read.length + r.write.length;
});

int pselect(int n, fd_set *restrict rfds, fd_set *restrict wfds, fd_set *restrict efds,
            const struct timespec *restrict ts, const sigset_t *restrict mask) {
  sigset_t old, pending;
  // Atomic unmask-and-wait, as far as we can: a signal pending in libc that
  // `mask` unblocks is delivered by sigprocmask itself, so do not wait at all.
  int delivered = 0;
  if (mask && sigpending(&pending) == 0) {
    for (int sig = 1; sig < _NSIG; sig++) {
      if (sigismember(&pending, sig) == 1 && sigismember(mask, sig) != 1) delivered = 1;
    }
  }
  if (mask) sigprocmask(SIG_SETMASK, mask, &old);
  if (delivered) {
    sigprocmask(SIG_SETMASK, &old, NULL);
    errno = EINTR;
    return -1;
  }
  int timeout_ms = ts ? (int)(ts->tv_sec * 1000 + ts->tv_nsec / 1000000) : -1;
  int r = slicc_select_js(n, rfds, wfds, timeout_ms);
  if (r == -1000) {
    struct timeval tv, *tvp = NULL;
    if (ts) {
      tv.tv_sec = ts->tv_sec;
      tv.tv_usec = ts->tv_nsec / 1000;
      tvp = &tv;
    }
    r = select(n, rfds, wfds, efds, tvp);
  } else if (r < 0) {
    errno = -r;
    r = -1;
  } else if (efds) {
    FD_ZERO(efds);
  }
  if (mask) sigprocmask(SIG_SETMASK, &old, NULL);
  return r;
}
