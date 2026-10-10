/* homescoop: wasix-libc v2025-09-02.1 libc-top-half/musl/src/termios/tcflush.c
 * (sha256 2ab71d4b…) with slicc-kernel (wasix-sysroot -21). */
#include <termios.h>
#ifndef __wasilibc_unmodified_upstream
#include <errno.h>
#include "slicc_tty.h"
#endif
#ifdef __wasilibc_unmodified_upstream	
#include <sys/ioctl.h>
#endif

int tcflush(int fd, int queue)
{
#ifdef __wasilibc_unmodified_upstream	
	return ioctl(fd, TCFLSH, queue);
#else
	/* homescoop: input queues through TCSAFLUSH with the current termios
	 * (slicc-kernel drops pending input when it can); output is written at
	 * once, so TCOFLUSH has nothing to drop. */
	if (queue != TCIFLUSH && queue != TCOFLUSH && queue != TCIOFLUSH) {
		errno = EINVAL;
		return -1;
	}
	struct termios tio;
	int k = __slicc_tty_tcgetattr(fd, &tio);
	if (k == SLICC_TTY_ENOSYS) return 0;
	if (k == 0 && queue != TCOFLUSH) k = __slicc_tty_tcsetattr(fd, TCSAFLUSH, &tio);
	if (k == 0) return 0;
	errno = k;
	return -1;
#endif
}
