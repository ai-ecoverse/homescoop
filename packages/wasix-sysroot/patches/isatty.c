/* homescoop: wasix-libc v2025-09-02.1 libc-bottom-half/sources/isatty.c
 * (sha256 0a84e6d7…) asking slicc-kernel per fd (wasix-sysroot -21). */
#include <wasi/api.h>
#include <__errno.h>
#include <__function___isatty.h>
#include "slicc_tty.h"
#undef weak /* musl features.h, via termios.h: the alias below spells it out */

int __isatty(int fd) {
    /* homescoop: slicc-kernel says per fd (slicc_tty.h). */
    struct winsize ws;
    int k = __slicc_tty_winsize(fd, &ws);
    if (k != SLICC_TTY_ENOSYS) {
        if (k == 0) return 1;
        errno = k;
        return 0;
    }
    __wasi_fdstat_t statbuf;
    int r = __wasi_fd_fdstat_get(fd, &statbuf);
    if (r != 0) {
        errno = r;
        return 0;
    }

    // A tty is a character device that we can't seek or tell on.
    if (statbuf.fs_filetype != __WASI_FILETYPE_CHARACTER_DEVICE ||
        (statbuf.fs_rights_base & (__WASI_RIGHTS_FD_SEEK | __WASI_RIGHTS_FD_TELL)) != 0) {
        errno = __WASI_ERRNO_NOTTY;
        return 0;
    }

    return 1;
}
extern __typeof(__isatty) isatty __attribute__((weak, alias("__isatty")));
