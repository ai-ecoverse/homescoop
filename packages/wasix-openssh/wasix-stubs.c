/*
 * WASIX link stubs for OpenSSH client. Headers may declare these; wasix-libc
 * does not always provide them. Prefer configure overrides (HAVE_PPOLL=0,
 * no HAVE_IFADDRS_H); these catch remaining references (e.g. madvise after
 * HAVE_MMAP + MADV_DONTDUMP).
 */
#include <errno.h>
#include <poll.h>
#include <signal.h>
#include <stddef.h>
#include <sys/types.h>
#include <time.h>

int
madvise(void *addr, size_t length, int advice)
{
	(void)addr;
	(void)length;
	(void)advice;
	return 0;
}

int
ppoll(struct pollfd *fds, nfds_t nfds, const struct timespec *timeout,
    const sigset_t *sigmask)
{
	int ms = -1;

	(void)sigmask;
	if (timeout != NULL) {
		ms = (int)(timeout->tv_sec * 1000 + timeout->tv_nsec / 1000000);
		if (ms < 0)
			ms = -1;
	}
	return poll(fds, nfds, ms);
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
