#include <errno.h>
#include <poll.h>
#include <stdint.h>
#include <wasi/api.h>

extern _Thread_local unsigned __slicc_signals_run;

static __wasi_errno_t idle(void)
{
	unsigned before = __slicc_signals_run;
	__wasi_subscription_t s = {
		.u.tag = __WASI_EVENTTYPE_CLOCK,
		.u.u.clock.id = __WASI_CLOCKID_MONOTONIC,
		.u.u.clock.timeout = 50000000,
	};
	__wasi_event_t e;
	__wasi_size_t n;
	while (__slicc_signals_run == before) {
		__wasi_errno_t err = __wasi_poll_oneoff(&s, &e, 1, &n);
		if (err && err != __WASI_ERRNO_INTR) return err;
	}
	return __WASI_ERRNO_INTR;
}

int poll(struct pollfd *fds, nfds_t nfds, int timeout)
{
	__wasi_subscription_t subs[2 * nfds + 1];
	__wasi_size_t ns = 0;
	int nval = 0;
	for (nfds_t i = 0; i < nfds; i++) {
		struct pollfd *p = &fds[i];
		p->revents = 0;
		if (p->fd < 0) continue;
		if (!(p->events & (POLLRDNORM | POLLWRNORM))) {
			__wasi_fdstat_t st;
			if (__wasi_fd_fdstat_get(p->fd, &st) == __WASI_ERRNO_BADF) { p->revents = POLLNVAL; nval++; }
			continue;
		}
		if (p->events & POLLRDNORM)
			subs[ns++] = (__wasi_subscription_t){ .userdata = (uintptr_t)p, .u.tag = __WASI_EVENTTYPE_FD_READ, .u.u.fd_read.file_descriptor = p->fd };
		if (p->events & POLLWRNORM)
			subs[ns++] = (__wasi_subscription_t){ .userdata = (uintptr_t)p, .u.tag = __WASI_EVENTTYPE_FD_WRITE, .u.u.fd_write.file_descriptor = p->fd };
	}
	if (nval) {
		if (ns == 0) return nval;
		timeout = 0;
	}
	if (timeout >= 0)
		subs[ns++] = (__wasi_subscription_t){ .u.tag = __WASI_EVENTTYPE_CLOCK, .u.u.clock.id = __WASI_CLOCKID_REALTIME, .u.u.clock.timeout = timeout ? (__wasi_timestamp_t)timeout * 1000000 : 1 };
	__wasi_event_t ev[ns ? ns : 1];
	__wasi_size_t ne = 0;
	__wasi_errno_t err = ns ? __wasi_poll_oneoff(subs, ev, ns, &ne) : idle();
	if (err) { errno = err; return -1; }
	for (__wasi_size_t i = 0; i < ne; i++) {
		const __wasi_event_t *e = &ev[i];
		if (e->type != __WASI_EVENTTYPE_FD_READ && e->type != __WASI_EVENTTYPE_FD_WRITE) continue;
		struct pollfd *p = (struct pollfd *)(uintptr_t)e->userdata;
		if (e->error == __WASI_ERRNO_BADF) p->revents |= POLLNVAL;
		else if (e->error == __WASI_ERRNO_PIPE) p->revents |= POLLHUP;
		else if (e->error) p->revents |= POLLERR;
		else {
			p->revents |= e->type == __WASI_EVENTTYPE_FD_READ ? POLLRDNORM : POLLWRNORM;
			if (e->fd_readwrite.flags & __WASI_EVENTRWFLAGS_FD_READWRITE_HANGUP) p->revents |= POLLHUP;
		}
	}
	int r = 0;
	for (nfds_t i = 0; i < nfds; i++) {
		if (fds[i].revents & POLLHUP) fds[i].revents &= ~POLLWRNORM;
		if (fds[i].revents) r++;
	}
	return r;
}
