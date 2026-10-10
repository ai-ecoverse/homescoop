/* homescoop: wasix-libc v2025-09-02.1 libc-top-half/musl/src/signal/setitimer.c
 * (sha256 4d773840…) with it_value through proc_raise_interval2, ITIMER_REAL only (wasix-sysroot -19).
 * Since -22 getitimer() lives here too, so the time-left helper is static:
 * a dynamic-main (wasix-python) exports hidden symbols as well. */
#include <sys/time.h>
#include <errno.h>
#include <stdint.h>
#ifdef __wasilibc_unmodified_upstream
#include "syscall.h"
#else
#include <wasi/api.h>
#endif

#ifndef __wasilibc_unmodified_upstream
/* A private name: sysroot-ehpic's __wasixlibc_real.o already defines
 * __wasi_proc_raise_interval2 (wasix-python's libc patch). */
__attribute__((import_module("wasix_32v1"), import_name("proc_raise_interval2")))
int32_t __homescoop_proc_raise_interval2(int32_t sig, int64_t initial, int64_t interval, int32_t repeat);
#endif

#ifndef __wasilibc_unmodified_upstream
/* The armed ITIMER_REAL, on the monotonic clock: deadline 0 is disarmed. */
static struct {
	__wasi_timestamp_t deadline, interval;
} real_timer;

static __wasi_timestamp_t mono_ns(void)
{
	__wasi_timestamp_t t = 0;
	(void)__wasi_clock_time_get(__WASI_CLOCKID_MONOTONIC, 1, &t);
	return t;
}

/* The time left on ITIMER_REAL, as setitimer's `old` and getitimer() report
 * it: a repeating timer counts to its next expiry, a fired one-shot is 0. */
static void itimer_real_left(struct itimerval *out)
{
	__wasi_timestamp_t now = mono_ns(), left = 0, d = real_timer.deadline, i = real_timer.interval;
	if (d) {
		if (now < d) left = d - now;
		else if (i) left = i - (now - d) % i;
		else real_timer.deadline = 0;
	}
	out->it_value.tv_sec = left / 1000000000ull;
	out->it_value.tv_usec = left % 1000000000ull / 1000;
	if (d && left && out->it_value.tv_sec == 0 && out->it_value.tv_usec == 0) out->it_value.tv_usec = 1;
	out->it_interval.tv_sec = i / 1000000000ull;
	out->it_interval.tv_usec = i % 1000000000ull / 1000;
}
#endif

#define IS32BIT(x) !((x)+0x80000000ULL>>32)

int setitimer(int which, const struct itimerval *restrict new, struct itimerval *restrict old)
{
#ifdef __wasilibc_unmodified_upstream
	if (sizeof(time_t) > sizeof(long)) {
		time_t is = new->it_interval.tv_sec, vs = new->it_value.tv_sec;
		long ius = new->it_interval.tv_usec, vus = new->it_value.tv_usec;
		if (!IS32BIT(is) || !IS32BIT(vs))
			return __syscall_ret(-ENOTSUP);
		long old32[4];
		int r = __syscall(SYS_setitimer, which,
			((long[]){is, ius, vs, vus}), old32);
		if (!r && old) {
			old->it_interval.tv_sec = old32[0];
			old->it_interval.tv_usec = old32[1];
			old->it_value.tv_sec = old32[2];
			old->it_value.tv_usec = old32[3];
		}
		return __syscall_ret(r);
	}
	return syscall(SYS_setitimer, which, new, old);
#else
	/* homescoop: proc_raise_interval2 takes it_value (the first expiry) and
	 * it_interval, so alarm(N) and one-shot timers fire; upstream passed
	 * it_interval alone to the 3-arg proc_raise_interval, so alarm(N)
	 * (interval 0) cancelled the timer. Only ITIMER_REAL exists: WASIX has
	 * no CPU-time clocks, and a wall-clock SIGVTALRM/SIGPROF would surprise
	 * a profiler, so ITIMER_VIRTUAL and ITIMER_PROF fail with EINVAL. The
	 * REAL timer is tracked here for `old` and getitimer(). */
	if (which != ITIMER_REAL) {
		errno = EINVAL;
		return -1;
	}
	if (new->it_value.tv_sec < 0 || new->it_value.tv_usec < 0 || new->it_value.tv_usec >= 1000000 ||
	    new->it_interval.tv_sec < 0 || new->it_interval.tv_usec < 0 || new->it_interval.tv_usec >= 1000000) {
		errno = EINVAL;
		return -1;
	}
	__wasi_timestamp_t initial =
		((__wasi_timestamp_t)new->it_value.tv_sec * 1000000000ull) +
		((__wasi_timestamp_t)new->it_value.tv_usec * 1000ull);
	__wasi_timestamp_t interval =
		((__wasi_timestamp_t)new->it_interval.tv_sec * 1000000000ull) +
		((__wasi_timestamp_t)new->it_interval.tv_usec * 1000ull);
	if (!initial) interval = 0;
	if (old) itimer_real_left(old);
	int ret = __homescoop_proc_raise_interval2(__WASI_SIGNAL_ALRM, initial, interval,
	                                           interval != 0 ? __WASI_BOOL_TRUE : __WASI_BOOL_FALSE);
	if (ret != 0) {
		errno = ret;
		return -1;
	}
	real_timer.deadline = initial ? mono_ns() + initial : 0;
	real_timer.interval = interval;
	return 0;
#endif
}

#ifndef __wasilibc_unmodified_upstream
/* musl's getitimer.c (sha256 6f392c93…) for WASIX: upstream returned EINVAL
 * as a value and left `old` alone. ITIMER_REAL is the one kept above. */
int getitimer(int which, struct itimerval *old)
{
	if (which != ITIMER_REAL) {
		errno = EINVAL;
		return -1;
	}
	itimer_real_left(old);
	return 0;
}
#endif
