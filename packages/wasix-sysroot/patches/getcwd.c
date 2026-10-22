#include <unistd.h>
#include <errno.h>
#include <string.h>
#include <stdlib.h>
#include <wasi/api.h>
#include "lock.h"

char *__wasilibc_cwd = "/";
extern int __wasilibc_cwd_is_synced __attribute__((__weak__));

#ifdef _REENTRANT
static volatile int lock[1];
void __wasilibc_cwd_lock(void) { LOCK(lock); }
void __wasilibc_cwd_unlock(void) { UNLOCK(lock); }
#else
#define __wasilibc_cwd_lock() (void)0
#define __wasilibc_cwd_unlock() (void)0
#endif

static int __slicc_cwd_fd_named = 0;

static int __slicc_synced(void)
{
    int *flag = &__wasilibc_cwd_is_synced;
    return flag != NULL && *flag;
}

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

static char *slicc_host_getcwd(char *buf, size_t size)
{
    __wasi_pointersize_t len = size;
    __wasi_errno_t error = __wasi_getcwd((uint8_t *)buf, &len);
    if (error != 0) {
        errno = error;
        return NULL;
    }
    if (len >= size) {
        errno = ERANGE;
        return NULL;
    }
    buf[len] = 0;
    return buf;
}

char *getcwd(char *buf, size_t size)
{
    if (buf != NULL && size == 0) {
        errno = EINVAL;
        return NULL;
    }
    if (__slicc_synced() && !__slicc_cwd_fd_live()) {
        if (buf != NULL || size == 0)
            return getcwd_legacy(buf, size);
        char *m = malloc(size);
        if (m == NULL) {
            errno = ENOMEM;
            return NULL;
        }
        if (getcwd_legacy(m, size) == NULL) {
            free(m);
            errno = ERANGE;
            return NULL;
        }
        return m;
    }
    if (buf != NULL)
        return slicc_host_getcwd(buf, size);
    for (int tries = 0; tries < 4; tries++) {
        __wasi_pointersize_t len = size;
        if (size == 0) {
            __wasi_errno_t error = __wasi_getcwd(NULL, &len);
            if (error != 0 && error != ERANGE) {
                errno = error;
                return NULL;
            }
            len++;
        }
        char *m = malloc(len);
        if (m == NULL) {
            errno = ENOMEM;
            return NULL;
        }
        if (slicc_host_getcwd(m, len) != NULL)
            return m;
        int e = errno;
        free(m);
        errno = e;
        if (e != ERANGE || size != 0)
            return NULL;
    }
    errno = ERANGE;
    return NULL;
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
