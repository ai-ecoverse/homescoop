/* WASIX fcntl.h omits POSIX file-locking constants.
 * Use values that do NOT collide with wasi-libc's F_GETFD..F_DUPFD_CLOEXEC (1..6).
 * Advisory locks are no-ops in the SLICC realm (see lock_stubs.c / libc patches).
 */
#ifndef HOMESCOOP_FCNTL_WASIX_EXTRA_H
#define HOMESCOOP_FCNTL_WASIX_EXTRA_H

#ifndef F_RDLCK
#define F_RDLCK 0
#endif
#ifndef F_WRLCK
#define F_WRLCK 1
#endif
#ifndef F_UNLCK
#define F_UNLCK 2
#endif
/* After WASI F_DUPFD_CLOEXEC (6) — must not reuse 5/6 (F_DUPFD / F_DUPFD_CLOEXEC). */
#ifndef F_GETLK
#define F_GETLK 7
#endif
#ifndef F_SETLK
#define F_SETLK 8
#endif
#ifndef F_SETLKW
#define F_SETLKW 9
#endif
#ifndef LOCK_SH
#define LOCK_SH 1
#define LOCK_EX 2
#define LOCK_NB 4
#define LOCK_UN 8
#endif

#endif
