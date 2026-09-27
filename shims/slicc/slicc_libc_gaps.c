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
