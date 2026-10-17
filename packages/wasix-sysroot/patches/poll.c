#define _GNU_SOURCE
#include <errno.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <time.h>
#include <wasi/api.h>

__wasi_errno_t __slicc_poll_masked(const sigset_t *mask, const __wasi_subscription_t *in, __wasi_event_t *out, __wasi_size_t n, __wasi_size_t *nevents);

#define WATCH ((uintptr_t)1)
#define RECHECK_NS ((__wasi_timestamp_t)50000000)

static __wasi_timestamp_t now_ns(void)
{
	__wasi_timestamp_t t = 0;
	if (__wasi_clock_time_get(__WASI_CLOCKID_MONOTONIC, 1, &t)) t = 0;
	return t;
}

static int is_socket(int fd)
{
	__wasi_fdstat_t st;
	return __wasi_fd_fdstat_get(fd, &st) == 0 && (st.fs_filetype == __WASI_FILETYPE_SOCKET_STREAM || st.fs_filetype == __WASI_FILETYPE_SOCKET_DGRAM);
}

static int poll_core(struct pollfd *fds, nfds_t nfds, int has_timeout, __wasi_timestamp_t timeout, const sigset_t *mask)
{
	__wasi_timestamp_t deadline = 0;
	if (has_timeout && __builtin_add_overflow(now_ns(), timeout, &deadline)) deadline = UINT64_MAX;
	int skip_watch = 0;
	for (;;) {
		__wasi_subscription_t subs[2 * nfds + 1];
		__wasi_size_t ns = 0;
		int nval = 0;
		for (nfds_t i = 0; i < nfds; i++) {
			struct pollfd *p = &fds[i];
			p->revents = 0;
			if (p->fd < 0) continue;
			if (!(p->events & (POLLRDNORM | POLLWRNORM))) {
				__wasi_fdstat_t st;
				if (__wasi_fd_fdstat_get(p->fd, &st) == __WASI_ERRNO_BADF) {
					p->revents = POLLNVAL;
					nval++;
					continue;
				}
				if (skip_watch) continue;
				if (st.fs_rights_base & __WASI_RIGHTS_FD_READ)
					subs[ns++] = (__wasi_subscription_t){ .userdata = (uintptr_t)p | WATCH, .u.tag = __WASI_EVENTTYPE_FD_READ, .u.u.fd_read.file_descriptor = p->fd };
				else
					subs[ns++] = (__wasi_subscription_t){ .userdata = (uintptr_t)p | WATCH, .u.tag = __WASI_EVENTTYPE_FD_WRITE, .u.u.fd_write.file_descriptor = p->fd };
				continue;
			}
			if (p->events & POLLRDNORM)
				subs[ns++] = (__wasi_subscription_t){ .userdata = (uintptr_t)p, .u.tag = __WASI_EVENTTYPE_FD_READ, .u.u.fd_read.file_descriptor = p->fd };
			if (p->events & POLLWRNORM)
				subs[ns++] = (__wasi_subscription_t){ .userdata = (uintptr_t)p, .u.tag = __WASI_EVENTTYPE_FD_WRITE, .u.u.fd_write.file_descriptor = p->fd };
		}
		if (nval) {
			if (ns == 0) return nval;
			subs[ns++] = (__wasi_subscription_t){ .u.tag = __WASI_EVENTTYPE_CLOCK, .u.u.clock.id = __WASI_CLOCKID_MONOTONIC, .u.u.clock.timeout = 1 };
		} else if (has_timeout || skip_watch) {
			__wasi_timestamp_t left = RECHECK_NS;
			if (has_timeout) {
				__wasi_timestamp_t t = now_ns();
				left = deadline > t ? deadline - t : 0;
				if (skip_watch && left > RECHECK_NS) left = RECHECK_NS;
			}
			subs[ns++] = (__wasi_subscription_t){ .u.tag = __WASI_EVENTTYPE_CLOCK, .u.u.clock.id = __WASI_CLOCKID_MONOTONIC, .u.u.clock.timeout = left ? left : 1 };
		}
		__wasi_event_t ev[ns ? ns : 1];
		__wasi_size_t ne = 0;
		__wasi_errno_t err = __slicc_poll_masked(mask, subs, ev, ns, &ne);
		if (err) { errno = err; return -1; }
		int quiet_watch = 0;
		for (__wasi_size_t i = 0; i < ne; i++) {
			const __wasi_event_t *e = &ev[i];
			if (e->type != __WASI_EVENTTYPE_FD_READ && e->type != __WASI_EVENTTYPE_FD_WRITE) continue;
			struct pollfd *p = (struct pollfd *)(uintptr_t)(e->userdata & ~WATCH);
			int watch = (e->userdata & WATCH) != 0;
			int gone = e->error == __WASI_ERRNO_PIPE || (!e->error && (e->fd_readwrite.flags & __WASI_EVENTRWFLAGS_FD_READWRITE_HANGUP));
			if (e->error == __WASI_ERRNO_BADF) p->revents |= POLLNVAL;
			else if (gone && e->type == __WASI_EVENTTYPE_FD_WRITE && watch) p->revents |= POLLERR;
			else if (gone && e->type == __WASI_EVENTTYPE_FD_WRITE && !is_socket(p->fd)) {
				/* -34 (homescoop#629): a pipe or FIFO write end whose readers are
				 * gone is writable and in error, as Linux's pipe_poll says: POLLOUT|POLLERR
				 * (the write then fails with EPIPE). POLLHUP is the read end's. */
				p->revents |= POLLWRNORM | POLLERR;
			} else if (e->error == __WASI_ERRNO_PIPE) p->revents |= POLLHUP;
			else if (e->error) p->revents |= POLLERR;
			else if (gone) {
				p->revents |= POLLHUP;
				if (!watch && e->type == __WASI_EVENTTYPE_FD_READ) p->revents |= POLLRDNORM;
			} else if (watch) {
				quiet_watch = 1;
			} else {
				p->revents |= e->type == __WASI_EVENTTYPE_FD_READ ? POLLRDNORM : POLLWRNORM;
			}
		}
		int r = 0;
		for (nfds_t i = 0; i < nfds; i++) {
			if (fds[i].revents & POLLHUP) fds[i].revents &= ~POLLWRNORM;
			if (fds[i].revents) r++;
		}
		if (r) return r;
		if (has_timeout && now_ns() >= deadline) return 0;
		if (quiet_watch) skip_watch = 1;
		else if (skip_watch) skip_watch = 0;
		else return 0;
	}
}

int poll(struct pollfd *fds, nfds_t nfds, int timeout)
{
	return poll_core(fds, nfds, timeout >= 0, timeout > 0 ? (__wasi_timestamp_t)timeout * 1000000 : 0, NULL);
}

int ppoll(struct pollfd *fds, nfds_t nfds, const struct timespec *timeout, const sigset_t *mask)
{
	__wasi_timestamp_t t = 0;
	if (timeout) {
		if (timeout->tv_sec < 0 || timeout->tv_nsec < 0 || timeout->tv_nsec >= 1000000000) { errno = EINVAL; return -1; }
		if (__builtin_mul_overflow((__wasi_timestamp_t)timeout->tv_sec, 1000000000, &t) || __builtin_add_overflow(t, (__wasi_timestamp_t)timeout->tv_nsec, &t)) t = UINT64_MAX;
	}
	return poll_core(fds, nfds, timeout != NULL, t, mask);
}
