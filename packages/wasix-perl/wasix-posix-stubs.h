/* WASIX shims for Perl POSIX.xs / core when building against wasix-libc. */
#ifndef HOMESCOOP_WASIX_POSIX_STUBS_H
#define HOMESCOOP_WASIX_POSIX_STUBS_H

#include <errno.h>
#include <string.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <unistd.h>
#include <sys/file.h>
#include <fcntl.h>
#include <time.h>

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


/*
 * flock: libc's own since 5.42.0-19 (wasix-sysroot 2025.9.30-34's flock.c,
 * slicc.flock in slicc-kernel 1.117.0, homescoop#758, #765). The lock belongs
 * to the open file description, on any descriptor, and LOCK_EX works on a
 * read-only handle. -15 to -18 emulated flock here with whole-file fcntl
 * record locks (per process, regular files only).
 */

#undef lockf
static inline int homescoop_lockf(int fd, int cmd, off_t len) {
  (void)len;
  if (fcntl(fd, F_GETFD) < 0) return -1;
  if (cmd != F_LOCK && cmd != F_TLOCK && cmd != F_ULOCK && cmd != F_TEST) { errno = EINVAL; return -1; }
  return 0;
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

/* mkfifo, mknod: libc's since 5.42.0-19 (wasix-sysroot -34, slicc_fs.path_mkfifo in
 * slicc-kernel 1.120.0, homescoop#878); up to -18 they failed with EOPNOTSUPP here. */

int eaccess(const char *path, int mode);

#undef futimes
static inline int homescoop_futimes(int fd, const struct timeval tv[2]) {
  if (!tv) return futimens(fd, NULL);
  if (tv[0].tv_usec < 0 || tv[0].tv_usec >= 1000000 || tv[1].tv_usec < 0 || tv[1].tv_usec >= 1000000) { errno = EINVAL; return -1; }
  struct timespec ts[2] = {
    { .tv_sec = tv[0].tv_sec, .tv_nsec = tv[0].tv_usec * 1000 },
    { .tv_sec = tv[1].tv_sec, .tv_nsec = tv[1].tv_usec * 1000 },
  };
  return futimens(fd, ts);
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

/* ctermid: declared in <stdio.h>, missing from libc.a (POSIX::ctermid). */
#include <stdio.h>
#include <string.h>
#undef ctermid
static inline char *homescoop_ctermid(char *s) {
  static char tty[] = "/dev/tty";
  return s ? strcpy(s, tty) : tty;
}
#define ctermid(s) homescoop_ctermid(s)

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
