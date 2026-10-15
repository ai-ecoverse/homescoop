#include <signal.h>
#include <errno.h>
#include <stdint.h>
#include <string.h>
#include <time.h>
#include <poll.h>
#include <wasi/api.h>

__attribute__((import_module("slicc"), import_name("sigmask_set")))
int32_t __slicc_sigmask_set(int32_t how, uint32_t set_lo, uint32_t set_hi, int32_t old_ptr);

__attribute__((import_module("slicc"), import_name("sigpending_get")))
int32_t __slicc_sigpending_get(int32_t ptr);

__attribute__((import_module("slicc"), import_name("sigmask_poll")))
int32_t __slicc_sigmask_poll(uint32_t set_lo, uint32_t set_hi, int32_t in_ptr, int32_t out_ptr, int32_t nsubscriptions, int32_t nevents_ptr);

extern _Thread_local unsigned __slicc_signals_run;

#define UNBLOCKABLE ((1ULL << (SIGKILL - 1)) | (1ULL << (SIGSTOP - 1)))
#define INTERNAL (0x7ULL << 31)

_Thread_local uint64_t __slicc_sigmask;

static uint64_t from_set(const sigset_t *set)
{
	uint64_t m;
	memcpy(&m, set, sizeof m);
	return m;
}

static void to_set(sigset_t *set, uint64_t m)
{
	memset(set, 0, sizeof *set);
	memcpy(set, &m, sizeof m);
}

static uint64_t applied(int how, uint64_t cur, uint64_t s)
{
	if (how == SIG_BLOCK) return cur | s;
	if (how == SIG_UNBLOCK) return cur & ~s;
	return s;
}

int pthread_sigmask(int how, const sigset_t *restrict set, sigset_t *restrict old)
{
	uint64_t s = 0, prev = 0;
	if (set) {
		if ((unsigned)how - SIG_BLOCK > 2U) return EINVAL;
		s = from_set(set) & ~UNBLOCKABLE & ~INTERNAL;
	} else {
		how = SIG_BLOCK;
	}
	int32_t err = __slicc_sigmask_set(how, (uint32_t)s, (uint32_t)(s >> 32), (int32_t)(uintptr_t)&prev);
	if (err == ENOSYS) {
		prev = __slicc_sigmask;
	} else if (err) {
		return err;
	}
	__slicc_sigmask = applied(how, prev, s);
	if (old) to_set(old, prev);
	return 0;
}

int sigpending(sigset_t *set)
{
	uint64_t p = 0;
	int32_t err = __slicc_sigpending_get((int32_t)(uintptr_t)&p);
	if (err == ENOSYS) {
		p = 0;
	} else if (err) {
		errno = err;
		return -1;
	}
	to_set(set, p);
	return 0;
}

static __wasi_errno_t idle(unsigned before)
{
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

__wasi_errno_t __slicc_poll_masked(const sigset_t *mask, const __wasi_subscription_t *in, __wasi_event_t *out, __wasi_size_t n, __wasi_size_t *nevents)
{
	*nevents = 0;
	if (!mask) {
		if (n) return __wasi_poll_oneoff(in, out, n, nevents);
		return idle(__slicc_signals_run);
	}
	uint64_t s = from_set(mask) & ~UNBLOCKABLE & ~INTERNAL;
	__wasi_size_t got = 0;
	int32_t err = __slicc_sigmask_poll((uint32_t)s, (uint32_t)(s >> 32), (int32_t)(uintptr_t)in, (int32_t)(uintptr_t)out, (int32_t)n, (int32_t)(uintptr_t)&got);
	if (err != ENOSYS) {
		*nevents = got;
		return (__wasi_errno_t)err;
	}
	unsigned before = __slicc_signals_run;
	sigset_t old;
	pthread_sigmask(SIG_SETMASK, mask, &old);
	__wasi_errno_t r;
	if (__slicc_signals_run != before) {
		r = __WASI_ERRNO_INTR;
	} else if (n) {
		r = __wasi_poll_oneoff(in, out, n, nevents);
	} else {
		r = idle(before);
	}
	pthread_sigmask(SIG_SETMASK, &old, NULL);
	return r;
}

int sigsuspend(const sigset_t *mask)
{
	__wasi_size_t n;
	__wasi_errno_t err = __slicc_poll_masked(mask, NULL, NULL, 0, &n);
	errno = err ? err : EINTR;
	return -1;
}

int sigtimedwait(const sigset_t *restrict mask, siginfo_t *restrict si, const struct timespec *restrict timeout)
{
	(void)mask; (void)si; (void)timeout;
	errno = ENOSYS;
	return -1;
}

int sigwaitinfo(const sigset_t *restrict mask, siginfo_t *restrict si)
{
	return sigtimedwait(mask, si, 0);
}

int sigwait(const sigset_t *restrict mask, int *restrict sig)
{
	(void)mask; (void)sig;
	return ENOSYS;
}

int ppoll(struct pollfd *fds, nfds_t nfds, const struct timespec *timeout, const sigset_t *mask)
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
	if (timeout) {
		if (timeout->tv_sec < 0 || timeout->tv_nsec < 0 || timeout->tv_nsec >= 1000000000) { errno = EINVAL; return -1; }
		__wasi_timestamp_t t;
		if (__builtin_mul_overflow((__wasi_timestamp_t)timeout->tv_sec, 1000000000, &t) || __builtin_add_overflow(t, (__wasi_timestamp_t)timeout->tv_nsec, &t)) t = UINT64_MAX;
		subs[ns++] = (__wasi_subscription_t){ .u.tag = __WASI_EVENTTYPE_CLOCK, .u.u.clock.id = __WASI_CLOCKID_MONOTONIC, .u.u.clock.timeout = t ? t : 1 };
	}
	if (nval) {
		if (timeout) ns--;
		if (ns == 0) return nval;
		subs[ns++] = (__wasi_subscription_t){ .u.tag = __WASI_EVENTTYPE_CLOCK, .u.u.clock.id = __WASI_CLOCKID_MONOTONIC, .u.u.clock.timeout = 1 };
	}
	__wasi_event_t ev[ns ? ns : 1];
	__wasi_size_t ne;
	__wasi_errno_t err = __slicc_poll_masked(mask, subs, ev, ns, &ne);
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

