#include <signal.h>
#include <errno.h>
#include <stdint.h>
#include <string.h>
#include <time.h>
#include <wasi/api.h>

__attribute__((import_module("slicc"), import_name("sigmask_set")))
int32_t __slicc_sigmask_set(int32_t how, uint32_t set_lo, uint32_t set_hi, int32_t old_ptr);

__attribute__((import_module("slicc"), import_name("sigpending_get")))
int32_t __slicc_sigpending_get(int32_t ptr);

__attribute__((import_module("slicc"), import_name("sigmask_poll")))
int32_t __slicc_sigmask_poll(uint32_t set_lo, uint32_t set_hi, int32_t in_ptr, int32_t out_ptr, int32_t nsubscriptions, int32_t nevents_ptr);

__attribute__((import_module("slicc"), import_name("sigwait")))
int32_t __slicc_sigwait(uint32_t set_lo, uint32_t set_hi, int64_t timeout_ns, int32_t sig_ptr);

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

static uint64_t now_ns(void)
{
	struct timespec t;
	clock_gettime(CLOCK_MONOTONIC, &t);
	return (uint64_t)t.tv_sec * 1000000000ULL + (uint64_t)t.tv_nsec;
}

int sigtimedwait(const sigset_t *restrict mask, siginfo_t *restrict si, const struct timespec *restrict timeout)
{
	uint64_t s = from_set(mask) & ~UNBLOCKABLE & ~INTERNAL;
	uint64_t ns = UINT64_MAX, deadline = 0;
	if (timeout) {
		if (timeout->tv_sec < 0 || (unsigned long)timeout->tv_nsec >= 1000000000UL) {
			errno = EINVAL;
			return -1;
		}
		ns = (uint64_t)timeout->tv_sec > (UINT64_MAX - 1 - (uint64_t)timeout->tv_nsec) / 1000000000ULL
			? UINT64_MAX - 1
			: (uint64_t)timeout->tv_sec * 1000000000ULL + (uint64_t)timeout->tv_nsec;
		deadline = now_ns();
		deadline = deadline > UINT64_MAX - 1 - ns ? UINT64_MAX - 1 : deadline + ns;
	}
	for (;;) {
		uint32_t sig = 0;
		int32_t err = __slicc_sigwait((uint32_t)s, (uint32_t)(s >> 32), (int64_t)ns, (int32_t)(uintptr_t)&sig);
		if (!err) {
			if (si) {
				memset(si, 0, sizeof *si);
				si->si_signo = (int)sig;
				si->si_code = SI_USER;
			}
			return (int)sig;
		}
		if (err != EINTR) {
			errno = err;
			return -1;
		}
		if (timeout) {
			uint64_t t = now_ns();
			ns = t >= deadline ? 0 : deadline - t;
		}
	}
}

int sigwaitinfo(const sigset_t *restrict mask, siginfo_t *restrict si)
{
	return sigtimedwait(mask, si, 0);
}

int sigwait(const sigset_t *restrict mask, int *restrict sig)
{
	int e = errno;
	int r = sigtimedwait(mask, 0, 0);
	if (r < 0) {
		int err = errno;
		errno = e;
		return err;
	}
	*sig = r;
	return 0;
}
