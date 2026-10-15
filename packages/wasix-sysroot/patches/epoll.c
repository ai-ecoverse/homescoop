#include <wasi/api.h>
#include <sys/epoll.h>
#include <signal.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdlib.h>

extern _Thread_local unsigned __slicc_signals_run;

int epoll_create(int size)
{
	if (size <= 0) { errno = EINVAL; return -1; }
	return epoll_create1(0);
}

int epoll_create1(int flags)
{
	if (flags & ~EPOLL_CLOEXEC) { errno = EINVAL; return -1; }
	int fd = 0;
	__wasi_errno_t err = __wasi_epoll_create(&fd);
	if (err) { errno = err; return -1; }
	if (flags & EPOLL_CLOEXEC) fcntl(fd, F_SETFD, FD_CLOEXEC);
	return fd;
}

static const struct { uint32_t c; __wasi_epoll_type_t w; } bits[] = {
	{ EPOLLIN, __WASI_EPOLL_TYPE_EPOLLIN },
	{ EPOLLOUT, __WASI_EPOLL_TYPE_EPOLLOUT },
	{ EPOLLRDHUP, __WASI_EPOLL_TYPE_EPOLLRDHUP },
	{ EPOLLPRI, __WASI_EPOLL_TYPE_EPOLLPRI },
	{ EPOLLERR, __WASI_EPOLL_TYPE_EPOLLERR },
	{ EPOLLHUP, __WASI_EPOLL_TYPE_EPOLLHUP },
	{ EPOLLET, __WASI_EPOLL_TYPE_EPOLLET },
	{ EPOLLONESHOT, __WASI_EPOLL_TYPE_EPOLLONESHOT },
};

int epoll_ctl(int fd, int op, int fd2, struct epoll_event *ev)
{
	__wasi_epoll_ctl_t wop;
	if (op == EPOLL_CTL_ADD) wop = __WASI_EPOLL_CTL_ADD;
	else if (op == EPOLL_CTL_MOD) wop = __WASI_EPOLL_CTL_MOD;
	else if (op == EPOLL_CTL_DEL) wop = __WASI_EPOLL_CTL_DEL;
	else { errno = EINVAL; return -1; }
	__wasi_epoll_event_t ev2 = { 0 };
	if (ev) {
		for (unsigned i = 0; i < sizeof bits / sizeof bits[0]; i++)
			if (ev->events & bits[i].c) ev2.events |= bits[i].w;
		ev2.data.ptr = (__wasi_pointersize_t)ev->data.ptr;
		ev2.data.fd = fd2;
		ev2.data.data1 = ev->data.u32;
		ev2.data.data2 = ev->data.u64;
	} else if (op != EPOLL_CTL_DEL) {
		errno = EFAULT;
		return -1;
	}
	__wasi_errno_t err = __wasi_epoll_ctl(fd, wop, fd2, ev ? &ev2 : NULL);
	if (err) { errno = err; return -1; }
	return 0;
}

static int wait_all(int fd, struct epoll_event *ev, int cnt, int to)
{
	__wasi_timestamp_t timeout = to < 0 ? UINT64_MAX : (__wasi_timestamp_t)to * 1000000;
	__wasi_epoll_event_t stack[64];
	__wasi_epoll_event_t *ev2 = stack;
	if (cnt > 64) {
		ev2 = malloc((size_t)cnt * sizeof *ev2);
		if (!ev2) { ev2 = stack; cnt = 64; }
	}
	__wasi_size_t n = 0;
	__wasi_errno_t err = __wasi_epoll_wait(fd, ev2, (__wasi_size_t)cnt, timeout, &n);
	if (!err) {
		for (__wasi_size_t c = 0; c < n; c++) {
			uint32_t e = 0;
			for (unsigned i = 0; i < sizeof bits / sizeof bits[0]; i++)
				if (ev2[c].events & bits[i].w) e |= bits[i].c;
			ev[c].events = e;
			ev[c].data.u64 = ev2[c].data.data2;
		}
	}
	if (ev2 != stack) free(ev2);
	if (err) { errno = err; return -1; }
	return (int)n;
}

int epoll_pwait(int fd, struct epoll_event *ev, int cnt, int to, const sigset_t *sigs)
{
	if (cnt <= 0 || (unsigned)cnt > SIZE_MAX / sizeof(__wasi_epoll_event_t)) { errno = EINVAL; return -1; }
	if (!sigs) return wait_all(fd, ev, cnt, to);
	unsigned before = __slicc_signals_run;
	sigset_t old;
	pthread_sigmask(SIG_SETMASK, sigs, &old);
	int r;
	if (__slicc_signals_run != before) {
		errno = EINTR;
		r = -1;
	} else {
		r = wait_all(fd, ev, cnt, to);
	}
	int e = errno;
	pthread_sigmask(SIG_SETMASK, &old, NULL);
	errno = e;
	return r;
}

int epoll_wait(int fd, struct epoll_event *ev, int cnt, int to)
{
	return epoll_pwait(fd, ev, cnt, to, 0);
}
