#ifndef SLICC_WASI_SYS_WAIT_H
#define SLICC_WASI_SYS_WAIT_H
/* WASI preview1 has no processes; libgit2's process API reports failure. */
#include <sys/types.h>
#include <errno.h>
#define WNOHANG 1
#define WIFEXITED(s) (((s) & 0x7f) == 0)
#define WEXITSTATUS(s) (((s) >> 8) & 0xff)
#define WIFSIGNALED(s) (((s) & 0x7f) != 0)
#define WTERMSIG(s) ((s) & 0x7f)
static inline pid_t waitpid(pid_t p, int *s, int o) { (void)p;(void)s;(void)o; errno = ENOSYS; return -1; }
#endif
