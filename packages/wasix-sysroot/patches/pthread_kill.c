/* homescoop: wasix-libc v2025-09-02.1 libc-top-half/musl/src/thread/pthread_kill.c
 * (sha256 f7f31ea3…) signalling the main thread through the process (wasix-sysroot -19). */
#include "pthread_impl.h"
#include "lock.h"
#ifdef __wasilibc_unmodified_upstream
#else
#include <wasi/api.h>
#include "signal.h"
#include <unistd.h>
#endif

#ifdef __wasilibc_unmodified_upstream
int pthread_kill(pthread_t t, int sig)
{
	int r;
	sigset_t set;
	/* Block not just app signals, but internal ones too, since
	 * pthread_kill is used to implement pthread_cancel, which
	 * must be async-cancel-safe. */
	__block_all_sigs(&set);
	LOCK(t->killlock);
	r = t->tid ? -__syscall(SYS_tkill, t->tid, sig)
		: (sig+0U >= _NSIG ? EINVAL : 0);
	UNLOCK(t->killlock);
	__restore_sigs(&set);
	return r;
}
#else
int pthread_kill(pthread_t t, int sig)
{
	sigset_t set;
	if (sig+0U >= _NSIG) return EINVAL;
	__block_all_sigs(&set);
	/* homescoop: the main thread keeps __init_tls's placeholder tid
	 * 0x3fffffff, which slicc-kernel's thread_signal does not know (ESRCH):
	 * signal the process instead, as raise() does. */
	int r = t->tid == 0x3fffffff
		? __wasi_proc_signal(getpid(), (__wasi_signal_t)sig)
		: __wasi_thread_signal(t->tid, (__wasi_signal_t)sig);
	__restore_sigs(&set);
	return r;
}
#endif