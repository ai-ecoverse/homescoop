#define _WASI_EMULATED_PROCESS_CLOCKS
#include <wasi/api.h>
#include <errno.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/times.h>
#include <time.h>

#define HOMESCOOP_NS_PER_TICK 10000000ULL

static __wasi_timestamp_t cpu_ns(__wasi_clockid_t id) {
  __wasi_timestamp_t ns = 0;
  if (__wasi_clock_time_get(id, 1, &ns) != 0) return 0;
  return ns;
}

clock_t clock(void) {
  __wasi_timestamp_t ns;
  if (__wasi_clock_time_get(__WASI_CLOCKID_PROCESS_CPUTIME_ID, 1, &ns) != 0) return (clock_t)-1;
  return (clock_t)ns;
}

clock_t times(struct tms *tms) {
  __wasi_timestamp_t real;
  __wasi_errno_t error = __wasi_clock_time_get(__WASI_CLOCKID_MONOTONIC, 1, &real);
  if (error != 0) {
    errno = error;
    return (clock_t)-1;
  }
  tms->tms_utime = (clock_t)(cpu_ns(__WASI_CLOCKID_PROCESS_CPUTIME_ID) / HOMESCOOP_NS_PER_TICK);
  tms->tms_stime = 0;
  tms->tms_cutime = 0;
  tms->tms_cstime = 0;
  return (clock_t)(real / HOMESCOOP_NS_PER_TICK);
}

int getrusage(int who, struct rusage *ru) {
  if (who != RUSAGE_SELF && who != RUSAGE_CHILDREN) {
    errno = EINVAL;
    return -1;
  }
  memset(ru, 0, sizeof *ru);
  if (who == RUSAGE_SELF) {
    __wasi_timestamp_t ns = cpu_ns(__WASI_CLOCKID_PROCESS_CPUTIME_ID);
    ru->ru_utime.tv_sec = (time_t)(ns / 1000000000ULL);
    ru->ru_utime.tv_usec = (suseconds_t)((ns % 1000000000ULL) / 1000ULL);
  }
  return 0;
}
