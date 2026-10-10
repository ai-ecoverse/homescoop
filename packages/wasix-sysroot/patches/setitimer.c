/* homescoop: wasix-libc v2025-09-02.1 libc-top-half/musl/src/signal/setitimer.c
 * (sha256 4d773840…) with it_value through proc_raise_interval2 (wasix-sysroot -19). */
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
	 * it_interval, so one-shot alarm(N) works. Upstream passed it_interval
	 * alone to the 3-arg proc_raise_interval, so alarm(N) (interval 0)
	 * cancelled the timer. `old` is not reported (no getitimer in WASIX). */
	(void)which;
	(void)old;
	__wasi_timestamp_t initial =
		((__wasi_timestamp_t)new->it_value.tv_sec * 1000000000ull) +
		((__wasi_timestamp_t)new->it_value.tv_usec * 1000ull);
	__wasi_timestamp_t interval =
		((__wasi_timestamp_t)new->it_interval.tv_sec * 1000000000ull) +
		((__wasi_timestamp_t)new->it_interval.tv_usec * 1000ull);
	int ret = __homescoop_proc_raise_interval2(__WASI_SIGNAL_ALRM, initial, interval,
	                                           interval != 0 ? __WASI_BOOL_TRUE : __WASI_BOOL_FALSE);
	if (ret != 0) {
		errno = ret;
		return -1;
	}
	return 0;
#endif
}
