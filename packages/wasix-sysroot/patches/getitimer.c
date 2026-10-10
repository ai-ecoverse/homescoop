/* homescoop: wasix-libc v2025-09-02.1 libc-top-half/musl/src/signal/getitimer.c
 * (sha256 6f392c93…) reporting the ITIMER_REAL setitimer.c keeps (wasix-sysroot -19). */
#include <sys/time.h>
#include <errno.h>
#ifdef __wasilibc_unmodified_upstream
#include "syscall.h"
#else
__attribute__((visibility("hidden"))) void __homescoop_itimer_real_left(struct itimerval *);
#endif

int getitimer(int which, struct itimerval *old)
{
#ifdef __wasilibc_unmodified_upstream
	if (sizeof(time_t) > sizeof(long)) {
		long old32[4];
		int r = __syscall(SYS_getitimer, which, old32);
		if (!r) {
			old->it_interval.tv_sec = old32[0];
			old->it_interval.tv_usec = old32[1];
			old->it_value.tv_sec = old32[2];
			old->it_value.tv_usec = old32[3];
		}
		return __syscall_ret(r);
	}
	return syscall(SYS_getitimer, which, old);
#else
	/* homescoop: upstream returned EINVAL as a value and left `old` alone.
	 * ITIMER_REAL is the one setitimer() keeps (setitimer.c). */
	if (which != ITIMER_REAL) {
		errno = EINVAL;
		return -1;
	}
	__homescoop_itimer_real_left(old);
	return 0;
#endif
}
