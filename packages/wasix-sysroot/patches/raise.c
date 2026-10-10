/* homescoop: wasix-libc v2025-09-02.1 libc-top-half/musl/src/signal/raise.c
 * (sha256 e0d12692…) signalling the process (wasix-sysroot -19). */
#include <signal.h>
#include <stdint.h>
#include <errno.h>
#include <unistd.h>
#ifdef __wasilibc_unmodified_upstream
#include "syscall.h"
#else
#include <wasi/api.h>
#endif
#include "pthread_impl.h"

int raise(int sig)
{
	sigset_t set;
#ifdef __wasilibc_unmodified_upstream
	__block_app_sigs(&set);
#endif
#ifdef __wasilibc_unmodified_upstream
	int ret = syscall(SYS_tkill, __pthread_self()->tid, sig);
#else
	/* homescoop: the process, as kill(getpid(), sig) does. slicc-kernel does
	 * not deliver thread_signal yet (slicc-kernel#250), so a handler never
	 * ran. A multithreaded process gets it on the thread the kernel picks. */
	int ret = __wasi_proc_signal(getpid(), (__wasi_signal_t)sig);
	if (ret != 0) {
		errno = ret;
		return -1;
	}
#endif
#ifdef __wasilibc_unmodified_upstream
	__restore_sigs(&set);
#endif
	return ret;
}