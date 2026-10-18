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

/* -34 (homescoop#770, slicc-kernel#892/#911, 1.114.0): sigwait with the
 * sender. The kernel fills the fields that fit in `size` bytes and writes back
 * how many it filled. Shared with sigaction.c's SA_SIGINFO path. */
__attribute__((import_module("slicc"), import_name("sigwait_info")))
int32_t __slicc_sigwait_info(uint32_t set_lo, uint32_t set_hi, int64_t timeout_ns, int32_t info_ptr);

struct __slicc_siginfo { uint32_t size; int32_t signo, code, pid; uint32_t uid; int32_t status; };
_Static_assert(sizeof(struct __slicc_siginfo) == 24, "slicc siginfo struct");

void __slicc_fill_siginfo(siginfo_t *si, int sig, const struct __slicc_siginfo *k)
{
	memset(si, 0, sizeof *si);
	si->si_signo = sig;
	si->si_code = SI_USER;
	if (!k) return;
	/* size covers the fields the kernel filled: code at 8, pid at 12, uid at 16, status at 20. */
	if (k->size >= 12) si->si_code = k->code;
	if (k->size >= 16) si->si_pid = k->pid;
	if (k->size >= 20) si->si_uid = k->uid;
	if (k->size >= 24 && sig == SIGCHLD) si->si_status = k->status;
}

static volatile int sigwait_info_missing;

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
	if (n) {
		/* -36 (homescoop#949): with an fd ready at entry, Linux returns it and
		 * keeps a signal the temporary mask would unblock pending (the old mask
		 * comes back unless the wait ends with EINTR). The kernel's masked wait
		 * delivers such a signal first, so look under the current mask, without
		 * waiting, before swapping it: clock subscriptions become "now". */
		__wasi_subscription_t now[n];
		for (__wasi_size_t i = 0; i < n; i++) {
			now[i] = in[i];
			if (now[i].u.tag == __WASI_EVENTTYPE_CLOCK) {
				now[i].u.u.clock.timeout = 0;
				now[i].u.u.clock.flags = 0;
			}
		}
		__wasi_size_t ne = 0;
		unsigned ran = __slicc_signals_run;
		__wasi_errno_t e = __wasi_poll_oneoff(now, out, n, &ne);
		if (e) return e;
		__wasi_size_t k = 0;
		for (__wasi_size_t i = 0; i < ne; i++)
			if (out[i].type != __WASI_EVENTTYPE_CLOCK) out[k++] = out[i];
		if (k) {
			*nevents = k;
			return 0;
		}
		/* A handler ran as the look began (a signal that came while the
		 * program computed): the call is interrupted, as the masked wait
		 * itself would have said (test/r28w.c "window"). */
		if (__slicc_signals_run != ran) return __WASI_ERRNO_INTR;
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
		int32_t err = ENOSYS;
		struct __slicc_siginfo k = { .size = sizeof k };
		if (!sigwait_info_missing) {
			err = __slicc_sigwait_info((uint32_t)s, (uint32_t)(s >> 32), (int64_t)ns, (int32_t)(uintptr_t)&k);
			if (err == ENOSYS) sigwait_info_missing = 1;
			else if (!err) {
				sig = (uint32_t)k.signo;
				if (si) __slicc_fill_siginfo(si, (int)sig, &k);
				return (int)sig;
			}
		}
		if (err == ENOSYS) {
			/* A kernel before 1.114.0: no sender, SI_USER with pid and uid 0 (-32). */
			err = __slicc_sigwait((uint32_t)s, (uint32_t)(s >> 32), (int64_t)ns, (int32_t)(uintptr_t)&sig);
			if (!err) {
				if (si) __slicc_fill_siginfo(si, (int)sig, 0);
				return (int)sig;
			}
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
