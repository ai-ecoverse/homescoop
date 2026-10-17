#ifndef SLICC_WASI_COMPAT_H
#define SLICC_WASI_COMPAT_H
/* libgit2 on WASI preview1: no users, processes, signals or outgoing
 * sockets. Cargo uses libgit2 only for local repositories in SLICC; these
 * stubs make the unreachable paths (git:// and ssh transports, credential
 * helpers) fail with ENOSYS. */
#include <sys/types.h>
#include <sys/socket.h>
#include <signal.h>
#include <errno.h>
static inline uid_t geteuid(void) { return 0; }
static inline uid_t getuid(void) { return 0; }
static inline gid_t getegid(void) { return 0; }
static inline gid_t getgid(void) { return 0; }
static inline pid_t getppid(void) { return 1; }
static inline pid_t getpgid(pid_t p) { (void)p; return 1; }
static inline pid_t getsid(pid_t p) { (void)p; return 1; }
static inline int socket(int d, int t, int p) { (void)d;(void)t;(void)p; errno = ENOSYS; return -1; }
static inline int connect(int f, const struct sockaddr *a, socklen_t l) { (void)f;(void)a;(void)l; errno = ENOSYS; return -1; }
static inline int setsockopt(int f, int l, int n, const void *v, socklen_t s) { (void)f;(void)l;(void)n;(void)v;(void)s; errno = ENOSYS; return -1; }
#ifndef SO_ERROR
#define SO_ERROR 4
#endif
#ifndef SO_KEEPALIVE
#define SO_KEEPALIVE 9
#endif
#ifndef POLLPRI
#define POLLPRI 0x002
#endif
static inline int pipe(int f[2]) { (void)f; errno = ENOSYS; return -1; }
static inline int dup2(int a, int b) { (void)a;(void)b; errno = ENOSYS; return -1; }
static inline pid_t fork(void) { errno = ENOSYS; return -1; }
static inline int execve(const char *p, char *const a[], char *const e[]) { (void)p;(void)a;(void)e; errno = ENOSYS; return -1; }
#ifndef SIG_BLOCK
#define SIG_BLOCK 0
#define SIG_SETMASK 2
#endif
static inline int sigemptyset(sigset_t *s) { *s = 0; return 0; }
static inline int sigaddset(sigset_t *s, int n) { (void)s;(void)n; return 0; }
static inline int sigismember(const sigset_t *s, int n) { (void)s;(void)n; return 0; }
static inline int sigpending(sigset_t *s) { *s = 0; return 0; }
static inline int sigwait(const sigset_t *s, int *n) { (void)s;(void)n; return ENOSYS; }
static inline int pthread_sigmask(int h, const sigset_t *s, sigset_t *o) { (void)h;(void)s; if (o) *o = 0; return 0; }
#endif
