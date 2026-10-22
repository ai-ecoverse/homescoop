#include <unistd.h>
#include <errno.h>
#include <string.h>
#include <stdlib.h>
#include <wasi/api.h>
#include "lock.h"

char *__wasilibc_cwd = "/";
int __slicc_cwd_synced = 0;
void *__libc_malloc(size_t);

#ifdef _REENTRANT
static volatile int lock[1];
void __wasilibc_cwd_lock(void) { LOCK(lock); }
void __wasilibc_cwd_unlock(void) { UNLOCK(lock); }
#else
#define __wasilibc_cwd_lock() (void)0
#define __wasilibc_cwd_unlock() (void)0
#endif

static int __slicc_cwd_fd_named = 0;

int __slicc_cwd_fd_live(void)
{
    __wasi_prestat_t prestat;
    if (__wasi_fd_prestat_get(3, &prestat) != __WASI_ERRNO_SUCCESS ||
        prestat.tag != __WASI_PREOPENTYPE_DIR || prestat.u.dir.pr_name_len != 1) {
        __slicc_cwd_fd_named = 0;
        return 0;
    }
    if (!__slicc_cwd_fd_named) {
        char name[2] = {0, 0};
        __slicc_cwd_fd_named = __wasi_fd_prestat_dir_name(3, (uint8_t *)name, 1) == __WASI_ERRNO_SUCCESS && name[0] == '.';
    }
    return __slicc_cwd_fd_named;
}

char *getcwd_legacy(char *buf, size_t size);

char *getcwd(char *buf, size_t size)
{
    if (__slicc_cwd_synced && !__slicc_cwd_fd_live())
        return getcwd_legacy(buf, size);
    __wasi_pointersize_t bufsize = size;
    __wasi_errno_t error = __wasi_getcwd((uint8_t *)buf, &bufsize);
    if (error == ERANGE && buf == NULL) {
        buf = (char *)__libc_malloc(bufsize);
        if (buf == NULL) {
            return NULL;
        }
        error = __wasi_getcwd((uint8_t *)buf, &bufsize);
    }

    if (error != 0) {
      errno = error;
      return NULL;
    }
    return buf;
}

char *getcwd_legacy(char *buf, size_t size)
{
    __wasilibc_cwd_lock();
    if (!buf) {
        buf = strdup(__wasilibc_cwd);
        if (!buf) {
            errno = ENOMEM;
            __wasilibc_cwd_unlock();
            return NULL;
        }
    } else {
        size_t len = strlen(__wasilibc_cwd);
        if (size < len + 1) {
            errno = ERANGE;
            __wasilibc_cwd_unlock();
            return NULL;
        }
        strcpy(buf, __wasilibc_cwd);
    }
    __wasilibc_cwd_unlock();
    return buf;
}
