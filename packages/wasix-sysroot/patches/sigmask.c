#include <signal.h>
#include <errno.h>
#include <stdint.h>
#include <string.h>

__attribute__((import_module("slicc"), import_name("sigmask_set")))
int32_t __slicc_sigmask_set(int32_t how, uint32_t set_lo, uint32_t set_hi, int32_t old_ptr);

__attribute__((import_module("slicc"), import_name("sigpending_get")))
int32_t __slicc_sigpending_get(int32_t ptr);

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
