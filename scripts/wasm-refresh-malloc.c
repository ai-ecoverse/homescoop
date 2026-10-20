/*
 * homescoop#1287: a threaded wasm C/C++ program's malloc family, wrapped at
 * link time (-Wl,--wrap=malloc,--wrap=calloc,--wrap=realloc,
 * --wrap=aligned_alloc,--wrap=posix_memalign,--wrap=memalign) so a block
 * that ends above this thread's view of the shared memory refreshes the view
 * (memory.grow(0)) before the caller touches it. V8 checks a thread's
 * memory.fill/memory.copy against that thread's cached memory length, which
 * can lag a memory.grow another thread's malloc did (slicc-kernel#1172).
 * The C counterpart of scripts/rust-wasm-refresh-alloc.rs:
 * - calloc is malloc + refresh + memset, and realloc (growing) is
 *   malloc + refresh + memcpy + free: libc's own would fill or copy into the
 *   new block before returning, with the stale view;
 * - HOMESCOOP_WASM_PEAK=<path>: each time malloc's highest block end passes
 *   another 4 MiB, (re)write "<heap end> <memory size>" in bytes to <path>.
 *   Measured inside the allocating thread, so not a stale view (a thread's
 *   VmSize can be); written as it grows because a program may leave with
 *   proc_exit, past atexit (zig does).
 */
#include <errno.h>
#include <fcntl.h>
#include <unistd.h>
#include <malloc.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void *__real_malloc(size_t);
void *__real_calloc(size_t, size_t);
void *__real_realloc(void *, size_t);
void *__real_aligned_alloc(size_t, size_t);
int __real_posix_memalign(void **, size_t, size_t);
void *__real_memalign(size_t, size_t);

static _Atomic uintptr_t homescoop_peak;

static void homescoop_peak_write(uintptr_t end) {
  const char *path = getenv("HOMESCOOP_WASM_PEAK");
  if (!path || !*path) return;
  /* open/write, not stdio: no malloc inside malloc. */
  int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd < 0) return;
  char buf[48];
  int len = snprintf(buf, sizeof buf, "%lu %lu\n", (unsigned long)end,
                     (unsigned long)__builtin_wasm_memory_size(0) * 65536ul);
  if (len > 0) (void)write(fd, buf, (size_t)len);
  close(fd);
}

static void *homescoop_seen(void *p, size_t n) {
  if (!p) return p;
  uintptr_t end = (uintptr_t)p + n;
  if (end > (uintptr_t)__builtin_wasm_memory_size(0) * 65536u) (void)__builtin_wasm_memory_grow(0, 0);
  uintptr_t old = atomic_load_explicit(&homescoop_peak, memory_order_relaxed);
  while (end > old && !atomic_compare_exchange_weak(&homescoop_peak, &old, end)) {
  }
  if (end > old && (end >> 22) != (old >> 22)) homescoop_peak_write(end);
  return p;
}

void *__wrap_malloc(size_t n) { return homescoop_seen(__real_malloc(n), n); }

void *__wrap_calloc(size_t m, size_t n) {
  size_t total;
  if (__builtin_mul_overflow(m, n, &total)) {
    errno = ENOMEM;
    return NULL;
  }
  void *p = homescoop_seen(__real_malloc(total), total);
  if (p) memset(p, 0, total);
  return p;
}

void *__wrap_realloc(void *p, size_t n) {
  if (!p) return __wrap_malloc(n);
  if (n == 0) return __real_realloc(p, 0);
  size_t old = malloc_usable_size(p);
  if (n <= old) return p;
  void *q = homescoop_seen(__real_malloc(n), n);
  if (q) {
    memcpy(q, p, old);
    free(p);
  }
  return q;
}

void *__wrap_aligned_alloc(size_t a, size_t n) { return homescoop_seen(__real_aligned_alloc(a, n), n); }

void *__wrap_memalign(size_t a, size_t n) { return homescoop_seen(__real_memalign(a, n), n); }

int __wrap_posix_memalign(void **out, size_t a, size_t n) {
  int r = __real_posix_memalign(out, a, n);
  if (r == 0) homescoop_seen(*out, n);
  return r;
}
