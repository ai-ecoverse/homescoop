/*
 * Advisory file locks are no-ops in the SLICC realm (match Emscripten).
 * Link with --wrap=flock,--wrap=fcntl,--wrap=lockf.
 *
 * flock() / fcntl(F_SETLK|F_SETLKW) / lockf() → 0
 * fcntl(F_GETLK) → 0 with l_type = F_UNLCK
 *
 * Lock cmd numbers come from fcntl_wasix_extra.h (7/8/9) so they do not
 * collide with wasi-libc F_DUPFD(5) / F_DUPFD_CLOEXEC(6).
 */
#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdint.h>
#include <sys/file.h>
#include <unistd.h>

#include "fcntl_wasix_extra.h"

int __real_fcntl(int fd, int cmd, ...);
int __real_flock(int fd, int op);
int __real_lockf(int fd, int op, off_t size);

int __wrap_flock(int fd, int op)
{
	(void)fd;
	(void)op;
	return 0;
}

int __wrap_fcntl(int fd, int cmd, ...)
{
	unsigned long arg = 0;
	va_list ap;
	va_start(ap, cmd);
	arg = va_arg(ap, unsigned long);
	va_end(ap);

	switch (cmd) {
	case F_SETLK:
	case F_SETLKW:
		return 0;
	case F_GETLK:
		if (arg) {
			struct flock *l = (struct flock *)(uintptr_t)arg;
			l->l_type = F_UNLCK;
			l->l_pid = 0;
		}
		return 0;
	default:
		return __real_fcntl(fd, cmd, arg);
	}
}

int __wrap_lockf(int fd, int op, off_t size)
{
	(void)fd;
	(void)op;
	(void)size;
	return 0;
}
