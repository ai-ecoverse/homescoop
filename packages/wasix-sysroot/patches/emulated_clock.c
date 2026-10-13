#define _WASI_EMULATED_PROCESS_CLOCKS
#include <wasi/api.h>
#include <time.h>

clock_t __clock(void) {
  __wasi_timestamp_t ns;
  if (__wasi_clock_time_get(__WASI_CLOCKID_PROCESS_CPUTIME_ID, 1, &ns) != 0) return (clock_t)-1;
  return (clock_t)ns;
}

__attribute__((__weak__, __alias__("__clock"))) clock_t clock(void);
