/* WASIX shims for Perl POSIX.xs / core when building against wasix-libc. */
#ifndef HOMESCOOP_WASIX_POSIX_STUBS_H
#define HOMESCOOP_WASIX_POSIX_STUBS_H

#include <errno.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <unistd.h>
#include <sys/file.h>

/* The asyncify sysroot's setjmp.h has sigjmp_buf but no prototypes, though
 * libc.a defines both; clang 21 rejects the implicit declaration. */
#if !defined(__wasm_exception_handling__) && !defined(__wasilibc_unmodified_upstream)
#include <setjmp.h>
int sigsetjmp(sigjmp_buf, int);
_Noreturn void siglongjmp(sigjmp_buf, int);
#endif

/* wasix bits/fenv.h only defines FE_TONEAREST */
#ifndef FE_TOWARDZERO
#define FE_TOWARDZERO 1
#endif
#ifndef FE_UPWARD
#define FE_UPWARD 2
#endif
#ifndef FE_DOWNWARD
#define FE_DOWNWARD 3
#endif

/*
 * Symbols declared or expected by Perl but missing from wasix-libc.a.
 * Return -1 / EOPNOTSUPP (or NULL) so builtins fail soft instead of
 * DIE("… not implemented"). Autoconf Autom4te::XFile tolerates EOPNOTSUPP.
 */
#define HOMESCOOP_STUB_ERR do { errno = EOPNOTSUPP; return -1; } while (0)


/* flock: declared in <sys/file.h>, not linked */
#undef flock
static inline int homescoop_flock(int fd, int operation) {
  (void)fd; (void)operation; HOMESCOOP_STUB_ERR;
}
#define flock(fd, op) homescoop_flock((fd), (op))

#undef lockf
static inline int homescoop_lockf(int fd, int cmd, off_t len) {
  (void)fd; (void)cmd; (void)len; HOMESCOOP_STUB_ERR;
}
#define lockf(fd, cmd, len) homescoop_lockf((fd), (cmd), (len))

#undef fchdir
static inline int homescoop_fchdir(int fd) {
  (void)fd; HOMESCOOP_STUB_ERR;
}
#define fchdir(fd) homescoop_fchdir((fd))

#undef pause
static inline int homescoop_pause(void) { HOMESCOOP_STUB_ERR; }
#define pause() homescoop_pause()

#undef getgroups
static inline int homescoop_getgroups(int size, gid_t *list) {
  (void)size; (void)list; HOMESCOOP_STUB_ERR;
}
#define getgroups(sz, list) homescoop_getgroups((sz), (list))

#undef mkfifo
static inline int homescoop_mkfifo(const char *path, mode_t mode) {
  (void)path; (void)mode; HOMESCOOP_STUB_ERR;
}
#define mkfifo(path, mode) homescoop_mkfifo((path), (mode))

#undef mknod
static inline int homescoop_mknod(const char *path, mode_t mode, dev_t dev) {
  (void)path; (void)mode; (void)dev; HOMESCOOP_STUB_ERR;
}
#define mknod(path, mode, dev) homescoop_mknod((path), (mode), (dev))

#undef eaccess
static inline int homescoop_eaccess(const char *path, int mode) {
  (void)path; (void)mode; HOMESCOOP_STUB_ERR;
}
#define eaccess(path, mode) homescoop_eaccess((path), (mode))

#undef futimes
static inline int homescoop_futimes(int fd, const struct timeval tv[2]) {
  (void)fd; (void)tv; HOMESCOOP_STUB_ERR;
}
#define futimes(fd, tv) homescoop_futimes((fd), (tv))

#undef chroot
static inline int homescoop_chroot(const char *path) {
  (void)path; HOMESCOOP_STUB_ERR;
}
#define chroot(path) homescoop_chroot((path))

#undef getlogin
static inline char *homescoop_getlogin(void) {
  errno = EOPNOTSUPP; return (char *)0;
}
#define getlogin() homescoop_getlogin()

#undef getpriority
static inline int homescoop_getpriority(int which, int who) {
  (void)which; (void)who; HOMESCOOP_STUB_ERR;
}
#define getpriority(w, who) homescoop_getpriority((w), (who))

#undef setpriority
static inline int homescoop_setpriority(int which, int who, int prio) {
  (void)which; (void)who; (void)prio; HOMESCOOP_STUB_ERR;
}
#define setpriority(w, who, prio) homescoop_setpriority((w), (who), (prio))

#endif /* HOMESCOOP_WASIX_POSIX_STUBS_H */
