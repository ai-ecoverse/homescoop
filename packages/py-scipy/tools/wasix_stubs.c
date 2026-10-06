/* WASIX stubs for symbols OpenBLAS/HiGHS/libf2c omit under single-threaded wasm. */
#include <stdio.h>

/* LAPACK xerbla_array — OpenBLAS static build does not export it.
 * SciPy/f2c ABI: returns int (same as xerbla_). */
int xerbla_array_(char *srname_array, int *srname_len, int *info)
{
  int n = (srname_len && *srname_len > 0) ? *srname_len : 0;
  fprintf(stderr, "** On entry to %.*s parameter number %d had an illegal value\n",
          n, srname_array ? srname_array : "?", info ? *info : -1);
  return 0;
}

/*
 * Itanium TLS init for HighsTaskExecutor::threadLocalWorkerDequePtr.
 * WASIX builds HiGHS without threads; provide an empty init guard.
 */
void _ZTHN17HighsTaskExecutor25threadLocalWorkerDequePtrE(void) {}

/* libf2c main.o expects a Fortran PROGRAM entry; extensions are not executables. */
int MAIN__(void) { return 0; }

/* Fortran PAUSE — no-op under WASIX (libf2c may omit pause.o). */
int pause(void) { return 0; }
