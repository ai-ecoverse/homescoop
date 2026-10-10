/*
 * WASIX link stubs for OpenSSH client. Headers may declare these; wasix-libc
 * does not always provide them. ppoll comes from openbsd-compat when
 * HAVE_PPOLL is unset. These catch madvise (mmap + MADV_DONTDUMP) and
 * getifaddrs residual refs.
 */
#include <errno.h>
#include <stddef.h>
#include <sys/types.h>

int
madvise(void *addr, size_t length, int advice)
{
	(void)addr;
	(void)length;
	(void)advice;
	return 0;
}

struct ifaddrs;

int
getifaddrs(struct ifaddrs **ifap)
{
	(void)ifap;
	errno = ENOSYS;
	return -1;
}

void
freeifaddrs(struct ifaddrs *ifa)
{
	(void)ifa;
}
