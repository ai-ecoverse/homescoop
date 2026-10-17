/* homescoop -34: flock(2) for WASIX programs (slicc-kernel#893, slicc.flock in
 * slicc-kernel 1.117.0). wasix-libc declares flock() in <sys/file.h> but has
 * no definition, so a link failed and configure scripts found no flock.
 *
 * slicc.flock(fd, op) takes Linux's op bits and answers a WASI errno: locks
 * per open file description on any descriptor (file, directory, pipe, socket,
 * terminal), EAGAIN (EWOULDBLOCK) for a LOCK_NB conflict, EINTR when a handled
 * signal ends a wait (with SA_RESTART the kernel restarts the wait itself,
 * slicc-kernel#931, 1.117.3), EBADF, EINVAL.
 *
 * A kernel without the import answers ENOSYS. flock() then falls back to a
 * whole-file fcntl record lock (F_SETLK/F_SETLKW through slicc.fcntl_lock),
 * the emulation perl and others used before: per process, not per open file
 * description, and an exclusive lock needs a descriptor open for writing. */
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <sys/file.h>
#include <unistd.h>

__attribute__((import_module("slicc"), import_name("flock")))
int32_t __slicc_flock(int32_t fd, int32_t op);

_Static_assert(LOCK_SH == 1 && LOCK_EX == 2 && LOCK_NB == 4 && LOCK_UN == 8, "slicc.flock op bits");

static volatile int flock_missing;

int flock(int fd, int op)
{
	if (!flock_missing) {
		int32_t e = __slicc_flock(fd, op);
		if (e == 0) return 0;
		if (e != ENOSYS) {
			errno = e;
			return -1;
		}
		flock_missing = 1;
	}
	struct flock l = { .l_whence = SEEK_SET, .l_start = 0, .l_len = 0 };
	switch (op & ~LOCK_NB) {
	case LOCK_SH: l.l_type = F_RDLCK; break;
	case LOCK_EX: l.l_type = F_WRLCK; break;
	case LOCK_UN: l.l_type = F_UNLCK; break;
	default:
		errno = EINVAL;
		return -1;
	}
	int r = fcntl(fd, (op & LOCK_NB) ? F_SETLK : F_SETLKW, &l);
	if (r < 0 && errno == EACCES) errno = EWOULDBLOCK;
	return r;
}
