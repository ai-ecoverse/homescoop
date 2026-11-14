#include <termios.h>
#ifdef __wasilibc_unmodified_upstream
#include <sys/ioctl.h>
#else
#include "slicc_tty.h"
#endif

int tcsendbreak(int fd, int dur)
{
#ifdef __wasilibc_unmodified_upstream
	return ioctl(fd, TCSBRK, 0);
#else
	int k = __slicc_tty_ioctl(fd, (int32_t)SLICC_LINUX_TCSBRK, 0);
	if (k == 0 || __slicc_tty_fallback(k)) return 0;
	errno = k;
	return -1;
#endif
}
