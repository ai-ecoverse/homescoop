/*
 * flock() is a no-op: wasix-sysroot has no flock yet. fcntl record locks
 * and lockf() go to libc since wasix-sysroot -30 (slicc.fcntl_lock).
 * Link with --wrap=flock.
 */
#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdint.h>
#include <sys/file.h>
#include <unistd.h>

#include "fcntl_wasix_extra.h"

int __real_flock(int fd, int op);

int __wrap_flock(int fd, int op)
{
	(void)fd;
	(void)op;
	return 0;
}

