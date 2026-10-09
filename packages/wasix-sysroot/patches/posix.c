//! POSIX-like functions supporting absolute path arguments, implemented in
//! terms of `__wasilibc_find_relpath` and `*at`-style functions.

#include <errno.h>
#include <dirent.h>
#include <fcntl.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>
#include <utime.h>
#include <wasi/libc.h>
#include <wasi/libc-find-relpath.h>
#include <wasi/libc-nocwd.h>
#include <stdarg.h>

// slicc: file modes through the kernel's slicc_fs imports (slicc-kernel#197).
// WASI has no mode-setting call. On kernels without slicc_fs, a program's
// own-namespace imports answer ENOSYS, and everything stays as upstream
// (chmod a no-op, modes dropped, a process-local umask).
#define SLICC_FS(name) __attribute__((import_module("slicc_fs"), import_name(#name)))
#define SLICC_FS_NOFOLLOW 1
SLICC_FS(fd_chmod) int __slicc_fs_fd_chmod(int fd, int mode);
SLICC_FS(path_chmod) int __slicc_fs_path_chmod(int dirfd, const char *path, int path_len, int mode, int flags);
SLICC_FS(umask) int __slicc_fs_umask(int mask, int *old);

static mode_t __slicc_local_umask = 022;

mode_t __slicc_umask_value(void) {
    int old;
    if (__slicc_fs_umask(0, &old) == 0) {
        __slicc_fs_umask(old, &old);
        return (mode_t)old;
    }
    return __slicc_local_umask;
}

// errno for a slicc_fs call: 0 on success or when the kernel lacks it.
int __slicc_fs_result(int e) {
    if (e == 0 || e == ENOSYS) return 0;
    errno = e;
    return -1;
}

int __slicc_fs_chmodat(int dirfd, const char *path, mode_t mode, int nofollow) {
    size_t len = 0;
    while (path[len]) len++;
    return __slicc_fs_result(__slicc_fs_path_chmod(dirfd, path, (int)len, (int)(mode & 07777),
                                                   nofollow ? SLICC_FS_NOFOLLOW : 0));
}

// A fresh create: apply mode & ~umask (an O_EXCL open, or a path that did not
// exist before). Failures here never fail the create itself.
void __slicc_fresh_fd_mode(int fd, mode_t mode) {
    __slicc_fs_fd_chmod(fd, (int)(mode & ~__slicc_umask_value() & 07777));
}

int __slicc_path_absent(int dirfd, const char *path) {
    struct stat st;
    int saved = errno;
    int absent = __wasilibc_nocwd_fstatat(dirfd, path, &st, AT_SYMLINK_NOFOLLOW) != 0 && errno == ENOENT;
    errno = saved;
    return absent;
}

static int find_relpath2(
    const char *path,
    char **relative,
    size_t *relative_len
) {
    const char *abs;
    return __wasilibc_find_relpath_alloc(path, &abs, relative, relative_len, 1);
}

// Helper to call `__wasilibc_find_relpath` and return an already-managed
// pointer for the `relative` path. This function is not reentrant since the
// `relative` pointer will point to static data that cannot be reused until
// `relative` is no longer used.
static int find_relpath(const char *path, char **relative) {
    static __thread char *relative_buf = NULL;
    static __thread size_t relative_buf_len = 0;
    int fd = find_relpath2(path, &relative_buf, &relative_buf_len);
    // find_relpath2 can update relative_buf, so assign it after the call
    *relative = relative_buf;
    return fd;
}

// same as `find_relpath`, but uses another set of static variables to cache
static int find_relpath_alt(const char *path, char **relative) {
    static __thread char *relative_buf = NULL;
    static __thread size_t relative_buf_len = 0;
    int fd = find_relpath2(path, &relative_buf, &relative_buf_len);
    // find_relpath2 can update relative_buf, so assign it after the call
    *relative = relative_buf;
    return fd;
}

int open(const char *path, int oflag, ...) {
    // WASI libc's `openat` ignores the mode argument, so call a special
    // entrypoint which avoids the varargs calling convention.
    if (!(oflag & O_CREAT)) return __wasilibc_open_nomode(path, oflag);
    va_list ap;
    va_start(ap, oflag);
    mode_t mode = va_arg(ap, int);
    va_end(ap);
    char *relative_path;
    int dirfd = find_relpath(path, &relative_path);
    if (dirfd == -1) {
        errno = ENOENT;
        return -1;
    }
    int fresh = (oflag & O_EXCL) || __slicc_path_absent(dirfd, relative_path);
    int fd = __wasilibc_nocwd_openat_nomode(dirfd, relative_path, oflag);
    if (fd >= 0 && fresh) __slicc_fresh_fd_mode(fd, mode);
    return fd;
}

// See the documentation in libc.h
int __wasilibc_open_nomode(const char *path, int oflag) {
    char *relative_path;
    int dirfd = find_relpath(path, &relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (dirfd == -1) {
        errno = ENOENT;
        return -1;
    }

    return __wasilibc_nocwd_openat_nomode(dirfd, relative_path, oflag);
}

int access(const char *path, int amode) {
    char *relative_path;
    int dirfd = find_relpath(path, &relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (dirfd == -1) {
        errno = ENOENT;
        return -1;
    }

    return __wasilibc_nocwd_faccessat(dirfd, relative_path, amode, 0);
}

ssize_t readlink(
    const char *restrict path,
    char *restrict buf,
    size_t bufsize)
{
    char *relative_path;
    int dirfd = find_relpath(path, &relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (dirfd == -1) {
        errno = ENOENT;
        return -1;
    }

    return __wasilibc_nocwd_readlinkat(dirfd, relative_path, buf, bufsize);
}

int stat(const char *restrict path, struct stat *restrict buf) {
    char *relative_path;
    int dirfd = find_relpath(path, &relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (dirfd == -1) {
        errno = ENOENT;
        return -1;
    }

    return __wasilibc_nocwd_fstatat(dirfd, relative_path, buf, 0);
}

int lstat(const char *restrict path, struct stat *restrict buf) {
    char *relative_path;
    int dirfd = find_relpath(path, &relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (dirfd == -1) {
        errno = ENOENT;
        return -1;
    }

    return __wasilibc_nocwd_fstatat(dirfd, relative_path, buf, AT_SYMLINK_NOFOLLOW);
}

int utime(const char *path, const struct utimbuf *times) {
    char *relative_path;
    int dirfd = find_relpath(path, &relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (dirfd == -1) {
        errno = ENOENT;
        return -1;
    }

    return __wasilibc_nocwd_utimensat(
             dirfd, relative_path,
                     times ? ((struct timespec [2]) {
                                 { .tv_sec = times->actime },
                                 { .tv_sec = times->modtime }
                             })
                           : NULL,
                     0);
}

int utimes(const char *path, const struct timeval times[2]) {
    char *relative_path;
    int dirfd = find_relpath(path, &relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (dirfd == -1) {
        errno = ENOENT;
        return -1;
    }

    return __wasilibc_nocwd_utimensat(
             dirfd, relative_path,
                     times ? ((struct timespec [2]) {
                                 { .tv_sec = times[0].tv_sec,
				   .tv_nsec = times[0].tv_usec * 1000 },
                                 { .tv_sec = times[1].tv_sec,
				   .tv_nsec = times[1].tv_usec * 1000 },
                             })
                           : NULL,
                     0);
}

int unlink(const char *path) {
    char *relative_path;
    int dirfd = find_relpath(path, &relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (dirfd == -1) {
        errno = ENOENT;
        return -1;
    }

    // `unlinkat` imports `__wasi_path_remove_directory` even when
    // `AT_REMOVEDIR` isn't passed. Instead, use a specialized function which
    // just imports `__wasi_path_unlink_file`.
    return __wasilibc_nocwd___wasilibc_unlinkat(dirfd, relative_path);
}

int rmdir(const char *path) {
    char *relative_path;
    int dirfd = find_relpath(path, &relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (dirfd == -1) {
        errno = ENOENT;
        return -1;
    }

    return __wasilibc_nocwd___wasilibc_rmdirat(dirfd, relative_path);
}

int remove(const char *path) {
    char *relative_path;
    int dirfd = find_relpath(path, &relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (dirfd == -1) {
        errno = ENOENT;
        return -1;
    }

    // First try to remove it as a file.
    int r = __wasilibc_nocwd___wasilibc_unlinkat(dirfd, relative_path);
    if (r != 0 && (errno == EISDIR || errno == ENOENT)) {
        // That failed, but it might be a directory.
        r = __wasilibc_nocwd___wasilibc_rmdirat(dirfd, relative_path);

        // If it isn't a directory, we lack capabilities to remove it as a file.
        if (errno == ENOTDIR)
            errno = ENOENT;
    }
    return r;
}

int mkdir(const char *path, mode_t mode) {
    char *relative_path;
    int dirfd = find_relpath(path, &relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (dirfd == -1) {
        errno = ENOENT;
        return -1;
    }

    int r = __wasilibc_nocwd_mkdirat_nomode(dirfd, relative_path);
    if (r == 0) __slicc_fs_chmodat(dirfd, relative_path, mode & ~__slicc_umask_value(), 0);
    return r;
}

mode_t umask(mode_t mode) {
    int old;
    if (__slicc_fs_umask((int)(mode & 0777), &old) == 0) return (mode_t)old;
    mode_t prev = __slicc_local_umask;
    __slicc_local_umask = mode & 0777;
    return prev;
}

int chmod(const char *path, mode_t mode) {
    char *relative_path;
    int dirfd = find_relpath(path, &relative_path);
    if (dirfd == -1) {
        errno = ENOENT;
        return -1;
    }
    return __slicc_fs_chmodat(dirfd, relative_path, mode, 0);
}

int fchmod(int fd, mode_t mode) {
    return __slicc_fs_result(__slicc_fs_fd_chmod(fd, (int)(mode & 07777)));
}

int fchmodat(int fd, const char *path, mode_t mode, int flag) {
    int nofollow = (flag & AT_SYMLINK_NOFOLLOW) != 0;
    if (fd == AT_FDCWD || path[0] == '/') {
        char *relative_path;
        int dirfd = find_relpath(path, &relative_path);
        if (dirfd == -1) {
            errno = ENOENT;
            return -1;
        }
        return __slicc_fs_chmodat(dirfd, relative_path, mode, nofollow);
    }
    return __slicc_fs_chmodat(fd, path, mode, nofollow);
}

DIR *opendir(const char *dirname) {
    char *relative_path;
    int dirfd = find_relpath(dirname, &relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (dirfd == -1) {
        errno = ENOENT;
        return NULL;
    }

    return __wasilibc_nocwd_opendirat(dirfd, relative_path);
}

int scandir(
    const char *restrict dir,
    struct dirent ***restrict namelist,
    int (*filter)(const struct dirent *),
    int (*compar)(const struct dirent **, const struct dirent **)
) {
    char *relative_path;
    int dirfd = find_relpath(dir, &relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (dirfd == -1) {
        errno = ENOENT;
        return -1;
    }

    return __wasilibc_nocwd_scandirat(dirfd, relative_path, namelist, filter, compar);
}

int symlink(const char *target, const char *linkpath) {
    char *relative_path;
    int dirfd = find_relpath(linkpath, &relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (dirfd == -1) {
        errno = ENOENT;
        return -1;
    }

    return __wasilibc_nocwd_symlinkat(target, dirfd, relative_path);
}

int link(const char *old, const char *new) {
    char *old_relative_path;
    int old_dirfd = find_relpath_alt(old, &old_relative_path);

    if (old_dirfd != -1) {
        char *new_relative_path;
        int new_dirfd = find_relpath(new, &new_relative_path);

        if (new_dirfd != -1)
            return __wasilibc_nocwd_linkat(old_dirfd, old_relative_path,
                                           new_dirfd, new_relative_path, 0);
    }

    // We couldn't find a preopen for it; fail as if we can't find the path.
    errno = ENOENT;
    return -1;
}

int rename(const char *old, const char *new) {
    char *old_relative_path;
    int old_dirfd = find_relpath_alt(old, &old_relative_path);

    if (old_dirfd != -1) {
        char *new_relative_path;
        int new_dirfd = find_relpath(new, &new_relative_path);

        if (new_dirfd != -1)
            return __wasilibc_nocwd_renameat(old_dirfd, old_relative_path,
                                             new_dirfd, new_relative_path);
    }

    // We couldn't find a preopen for it; fail as if we can't find the path.
    errno = ENOENT;
    return -1;
}

// Like `access`, but with `faccessat`'s flags argument.
int
__wasilibc_access(const char *path, int mode, int flags)
{
    char *relative_path;
    int dirfd = find_relpath(path, &relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (dirfd == -1) {
        errno = ENOENT;
        return -1;
    }

    return __wasilibc_nocwd_faccessat(dirfd, relative_path,
                                      mode, flags);
}

// Like `utimensat`, but without the `at` part.
int
__wasilibc_utimens(const char *path, const struct timespec times[2], int flags)
{
    char *relative_path;
    int dirfd = find_relpath(path, &relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (dirfd == -1) {
        errno = ENOENT;
        return -1;
    }

    return __wasilibc_nocwd_utimensat(dirfd, relative_path,
                                      times, flags);
}

// Like `stat`, but with `fstatat`'s flags argument.
int
__wasilibc_stat(const char *__restrict path, struct stat *__restrict st, int flags)
{
    char *relative_path;
    int dirfd = find_relpath(path, &relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (dirfd == -1) {
        errno = ENOENT;
        return -1;
    }

    return __wasilibc_nocwd_fstatat(dirfd, relative_path, st, flags);
}

// Like `link`, but with `linkat`'s flags argument.
int
__wasilibc_link(const char *oldpath, const char *newpath, int flags)
{
    char *old_relative_path;
    char *new_relative_path;
    int old_dirfd = find_relpath(oldpath, &old_relative_path);
    int new_dirfd = find_relpath(newpath, &new_relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (old_dirfd == -1 || new_dirfd == -1) {
        errno = ENOENT;
        return -1;
    }

    return __wasilibc_nocwd_linkat(old_dirfd, old_relative_path,
                                   new_dirfd, new_relative_path,
                                   flags);
}

// Like `__wasilibc_link`, but oldpath is relative to olddirfd.
int
__wasilibc_link_oldat(int olddirfd, const char *oldpath, const char *newpath, int flags)
{
    char *new_relative_path;
    int new_dirfd = find_relpath(newpath, &new_relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (new_dirfd == -1) {
        errno = ENOENT;
        return -1;
    }

    return __wasilibc_nocwd_linkat(olddirfd, oldpath,
                                   new_dirfd, new_relative_path,
                                   flags);
}

// Like `__wasilibc_link`, but newpath is relative to newdirfd.
int
__wasilibc_link_newat(const char *oldpath, int newdirfd, const char *newpath, int flags)
{
    char *old_relative_path;
    int old_dirfd = find_relpath(oldpath, &old_relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (old_dirfd == -1) {
        errno = ENOENT;
        return -1;
    }

    return __wasilibc_nocwd_linkat(old_dirfd, old_relative_path,
                                   newdirfd, newpath,
                                   flags);
}

// Like `rename`, but from is relative to fromdirfd.
int
__wasilibc_rename_oldat(int fromdirfd, const char *from, const char *to)
{
    char *to_relative_path;
    int to_dirfd = find_relpath(to, &to_relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (to_dirfd == -1) {
        errno = ENOENT;
        return -1;
    }

    return __wasilibc_nocwd_renameat(fromdirfd, from, to_dirfd, to_relative_path);
}

// Like `rename`, but to is relative to todirfd.
int
__wasilibc_rename_newat(const char *from, int todirfd, const char *to)
{
    char *from_relative_path;
    int from_dirfd = find_relpath(from, &from_relative_path);

    // If we can't find a preopen for it, fail as if we can't find the path.
    if (from_dirfd == -1) {
        errno = ENOENT;
        return -1;
    }

    return __wasilibc_nocwd_renameat(from_dirfd, from_relative_path, todirfd, to);
}
