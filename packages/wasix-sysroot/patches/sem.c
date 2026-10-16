#define sem_init __musl_sem_init
#define sem_destroy __musl_sem_destroy
#define sem_getvalue __musl_sem_getvalue
#define sem_post __musl_sem_post
#define sem_trywait __musl_sem_trywait
#define sem_timedwait __musl_sem_timedwait
#define sem_wait __musl_sem_wait
#define sem_open __musl_sem_open
#define sem_close __musl_sem_close
#define sem_unlink __musl_sem_unlink
#define __shm_mapname __musl_sem_shm_mapname
#include "sem_init.c"
#include "sem_destroy.c"
#include "sem_getvalue.c"
#include "sem_post.c"
#include "sem_trywait.c"
#include "sem_timedwait.c"
#include "sem_wait.c"
#include "sem_open.c"
#include "sem_unlink.c"
#undef sem_init
#undef sem_destroy
#undef sem_getvalue
#undef sem_post
#undef sem_trywait
#undef sem_timedwait
#undef sem_wait
#undef sem_open
#undef sem_close
#undef sem_unlink
#undef __shm_mapname
#undef malloc
#undef calloc
#undef realloc
#undef free

#include <stdint.h>

__attribute__((import_module("slicc"), import_name("sem_open")))
int32_t __slicc_sem_open(int32_t name, int32_t len, int32_t oflag, int32_t mode, int32_t value, int32_t handle_out);
__attribute__((import_module("slicc"), import_name("sem_close")))
int32_t __slicc_sem_close(int32_t handle);
__attribute__((import_module("slicc"), import_name("sem_unlink")))
int32_t __slicc_sem_unlink(int32_t name, int32_t len);
__attribute__((import_module("slicc"), import_name("sem_post")))
int32_t __slicc_sem_post(int32_t handle);
__attribute__((import_module("slicc"), import_name("sem_wait")))
int32_t __slicc_sem_wait(int32_t handle, int32_t how, int32_t clock, int64_t deadline_ns);
__attribute__((import_module("slicc"), import_name("sem_getvalue")))
int32_t __slicc_sem_getvalue(int32_t handle, int32_t value_out);

#define SLICC_SEM_TAG 0x5c1cc5e3
#define SLICC_SEM_MAX 256

static struct { sem_t *sem; uint32_t handle; int count; } named[SLICC_SEM_MAX];
static volatile int named_lock[1];

static int is_named(const sem_t *s)
{
	return s->__val[3] == SLICC_SEM_TAG;
}

static uint32_t handle_of(const sem_t *s)
{
	return (uint32_t)s->__val[0];
}

static int fail(int32_t err)
{
	errno = err;
	return -1;
}

int sem_init(sem_t *s, int pshared, unsigned value)
{
	int r = __musl_sem_init(s, pshared, value);
	if (!r) s->__val[3] = 0;
	return r;
}

int sem_destroy(sem_t *s)
{
	if (is_named(s)) return 0;
	return __musl_sem_destroy(s);
}

int sem_getvalue(sem_t *restrict s, int *restrict valp)
{
	if (!is_named(s)) return __musl_sem_getvalue(s, valp);
	int32_t v = 0;
	int32_t err = __slicc_sem_getvalue((int32_t)handle_of(s), (int32_t)(uintptr_t)&v);
	if (err) return fail(err);
	*valp = v;
	return 0;
}

int sem_post(sem_t *s)
{
	if (!is_named(s)) return __musl_sem_post(s);
	int32_t err = __slicc_sem_post((int32_t)handle_of(s));
	return err ? fail(err) : 0;
}

int sem_trywait(sem_t *s)
{
	if (!is_named(s)) return __musl_sem_trywait(s);
	int32_t err = __slicc_sem_wait((int32_t)handle_of(s), 1, 0, 0);
	return err ? fail(err) : 0;
}

int sem_timedwait(sem_t *restrict s, const struct timespec *restrict at)
{
	if (!is_named(s)) return __musl_sem_timedwait(s, at);
	if (!at) {
		int32_t err = __slicc_sem_wait((int32_t)handle_of(s), 0, 0, 0);
		return err ? fail(err) : 0;
	}
	if (at->tv_nsec < 0 || at->tv_nsec >= 1000000000L) return fail(EINVAL);
	int64_t ns;
	if (at->tv_sec < 0) ns = 0;
	else if (__builtin_mul_overflow((int64_t)at->tv_sec, (int64_t)1000000000, &ns) || __builtin_add_overflow(ns, (int64_t)at->tv_nsec, &ns)) ns = INT64_MAX;
	int32_t err = __slicc_sem_wait((int32_t)handle_of(s), 2, 0, ns);
	return err ? fail(err) : 0;
}

int sem_wait(sem_t *s)
{
	return sem_timedwait(s, 0);
}

sem_t *sem_open(const char *name, int flags, ...)
{
	mode_t mode = 0;
	unsigned value = 0;
	if (flags & O_CREAT) {
		va_list ap;
		va_start(ap, flags);
		mode = va_arg(ap, mode_t);
		value = va_arg(ap, unsigned);
		va_end(ap);
	}
	uint32_t h = 0;
	int32_t kflags = ((flags & O_CREAT) ? 1 : 0) | ((flags & O_EXCL) ? 2 : 0);
	int32_t err = __slicc_sem_open((int32_t)(uintptr_t)name, (int32_t)strlen(name), kflags, (int32_t)(mode & 0777), (int32_t)value, (int32_t)(uintptr_t)&h);
	if (err == ENOSYS) return __musl_sem_open(name, flags, mode, value);
	if (err) {
		errno = err;
		return SEM_FAILED;
	}
	LOCK(named_lock);
	int free_slot = -1;
	for (int i = 0; i < SLICC_SEM_MAX; i++) {
		if (named[i].sem && named[i].handle == h) {
			named[i].count++;
			sem_t *s = named[i].sem;
			UNLOCK(named_lock);
			return s;
		}
		if (!named[i].sem && free_slot < 0) free_slot = i;
	}
	sem_t *s = free_slot < 0 ? 0 : malloc(sizeof *s);
	if (!s) {
		UNLOCK(named_lock);
		__slicc_sem_close((int32_t)h);
		errno = free_slot < 0 ? EMFILE : ENOMEM;
		return SEM_FAILED;
	}
	memset(s, 0, sizeof *s);
	s->__val[0] = (int)h;
	s->__val[3] = SLICC_SEM_TAG;
	named[free_slot].sem = s;
	named[free_slot].handle = h;
	named[free_slot].count = 1;
	UNLOCK(named_lock);
	return s;
}

int sem_close(sem_t *s)
{
	if (!is_named(s)) return __musl_sem_close(s);
	uint32_t h = handle_of(s);
	int32_t err = __slicc_sem_close((int32_t)h);
	if (err) return fail(err);
	LOCK(named_lock);
	for (int i = 0; i < SLICC_SEM_MAX; i++) {
		if (named[i].sem == s) {
			if (--named[i].count == 0) {
				named[i].sem = 0;
				named[i].handle = 0;
				free(s);
			}
			break;
		}
	}
	UNLOCK(named_lock);
	return 0;
}

int sem_unlink(const char *name)
{
	int32_t err = __slicc_sem_unlink((int32_t)(uintptr_t)name, (int32_t)strlen(name));
	if (err == ENOSYS) return __musl_sem_unlink(name);
	return err ? fail(err) : 0;
}
