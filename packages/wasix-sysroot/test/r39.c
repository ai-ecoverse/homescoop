/* wasix-sysroot -39 probe (homescoop#1287, slicc-kernel#1172): malloc on
 * one thread grows the shared memory (sbrk -> memory.grow) and malloc on
 * another hands out a block from the new pages; V8 refreshes that other
 * thread's memory length lazily, so a memset (memory.fill) into the block
 * could trap "memory access out of bounds". dlmalloc-memory-view.patch
 * refreshes the view (memory.grow(0)) before such a block is returned.
 *
 * THREADS threads each allocate ROUNDS blocks of 16 KiB..784 KiB (the heap
 * grows in many small steps to a few hundred MiB), fill and copy each at once
 * with inlined memory.fill/memory.copy (a call would refresh the view),
 * check the bytes, and free about half as they go. Prints one line. */
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef THREADS
#define THREADS 24
#endif
#ifndef ROUNDS
#define ROUNDS 160
#endif

static unsigned long long bad;
static pthread_mutex_t mu = PTHREAD_MUTEX_INITIALIZER;

static void *worker(void *arg) {
  unsigned seed = 0x9e3779b9u * (unsigned)(uintptr_t)arg + 1;
  void *keep[ROUNDS] = {0};
  unsigned long long mine = 0;
  for (int i = 0; i < ROUNDS; i++) {
    seed = seed * 1103515245u + 12345u;
    size_t n = 16384 + (seed >> 8) % (768u << 10);
    unsigned char *p = malloc(n);
    if (!p) break;
    __builtin_memset(p, (int)(i + 1), n); /* memory.fill, inlined: no call to refresh the view */
    unsigned char *q = (seed & 1) ? calloc(1, n / 2) : realloc(malloc(4096), n / 2);
    if (q) {
      __builtin_memcpy(q, p, n / 2); /* memory.copy, inlined */
      if (q[0] != (unsigned char)(i + 1) || q[n / 2 - 1] != (unsigned char)(i + 1)) mine++;
      free(q);
    }
    if (p[0] != (unsigned char)(i + 1) || p[n - 1] != (unsigned char)(i + 1)) mine++;
    if (seed & 2) free(p); else keep[i] = p;
  }
  for (int i = 0; i < ROUNDS; i++) free(keep[i]);
  pthread_mutex_lock(&mu);
  bad += mine;
  pthread_mutex_unlock(&mu);
  return 0;
}

int main(void) {
  static pthread_t t[THREADS];
  size_t before = __builtin_wasm_memory_size(0);
  for (uintptr_t i = 0; i < THREADS; i++)
    if (pthread_create(&t[i], 0, worker, (void *)(i + 1)) != 0) { printf("pthread_create failed\n"); return 1; }
  for (int i = 0; i < THREADS; i++) pthread_join(t[i], 0);
  size_t after = __builtin_wasm_memory_size(0);
  printf("r39 threads=%d rounds=%d pages %zu->%zu bad=%llu\n", THREADS, ROUNDS, before, after, bad);
  return bad != 0;
}
