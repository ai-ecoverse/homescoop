/* homescoop: wasix-libc v2025-09-02.1 libc-top-half/musl/src/termios/tcdrain.c
 * (sha256 3b5c98c0…) with slicc-kernel (wasix-sysroot -21). */
#include <termios.h>
#include <sys/ioctl.h>
#ifndef __wasilibc_unmodified_upstream
#include <errno.h>
#include "slicc_tty.h"
#endif
#ifdef __wasilibc_unmodified_upstream	
#include "syscall.h"
#endif

int tcdrain(int fd)
{
#ifdef __wasilibc_unmodified_upstream	
	return syscall_cp(SYS_ioctl, fd, TCSBRK, 1);
#else
	/* homescoop: output is already written; only the fd's validity counts. */
	struct winsize ws;
	int k = __slicc_tty_winsize(fd, &ws);
	if (k == 0 || k == SLICC_TTY_ENOSYS) return 0;
	errno = k;
	return -1;
#endif
}
