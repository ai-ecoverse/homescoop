/* homescoop: wasix-libc v2025-09-02.1 libc-top-half/musl/src/termios/tcsetattr.c
 * (sha256 b9e5c3a3…) setting the whole termios through slicc-kernel (wasix-sysroot -21). */
#include <termios.h>
#ifdef __wasilibc_unmodified_upstream
#include <sys/ioctl.h>
#else
#include <errno.h>
#include <wasi/api.h>
#include "slicc_tty.h"
#include <string.h>
#endif
#include <errno.h>

int tcsetattr(int fd, int act, const struct termios *tio)
{
	if (act < 0 || act > 2) {
		errno = EINVAL;
		return -1;
	}
#ifdef __wasilibc_unmodified_upstream	
	return ioctl(fd, TCSETS+act, tio);
#else
	/* homescoop: the whole termios to slicc-kernel, so cfmakeraw really is
	 * raw (ISIG, IEXTEN, OPOST, c_iflag, c_cc; slicc_tty.h). */
	int k = __slicc_tty_tcsetattr(fd, act, tio);
	if (k != SLICC_TTY_ENOSYS) {
		if (k == 0) return 0;
		errno = k;
		return -1;
	}
	__wasi_tty_t tty;
	int r = __wasi_tty_get(&tty);
	if (r != 0) {
		errno = r;
		return -1;
	}

	if ((tio->c_lflag & ECHO) != 0) {
		tty.echo = __WASI_BOOL_TRUE;
	} else {
		tty.echo = __WASI_BOOL_FALSE;
	}

	if ((tio->c_lflag & ICANON) != 0) {
		tty.line_buffered = __WASI_BOOL_TRUE;
	} else {
		tty.line_buffered = __WASI_BOOL_FALSE;
	}

	if ((tio->c_lflag & IGNCR) != 0) {
		tty.line_feeds = __WASI_BOOL_TRUE;
	} else {
		tty.line_feeds = __WASI_BOOL_FALSE;
	}

	r = __wasi_tty_set(&tty);
	if (r != 0) {
		errno = r;
		return -1;
	}

	return 0;
#endif
}
