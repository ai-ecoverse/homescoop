// Copyright (c) 2015-2016 Nuxi, https://nuxi.nl/
//
// SPDX-License-Identifier: BSD-2-Clause

#include <wasi/api.h>
#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>

__attribute__((import_module("slicc"), import_name("fcntl_lock")))
int32_t __slicc_fcntl_lock(int32_t fd, int32_t cmd, int32_t flock_ptr);

_Static_assert(F_GETLK == 12 && F_SETLK == 13 && F_SETLKW == 14, "slicc.fcntl_lock cmd numbers");
_Static_assert(F_RDLCK == 0 && F_WRLCK == 1 && F_UNLCK == 2, "slicc.fcntl_lock l_type numbers");
_Static_assert(SEEK_SET == 0 && SEEK_CUR == 1 && SEEK_END == 2, "slicc.fcntl_lock l_whence numbers");
_Static_assert(sizeof(struct flock) == 32 && offsetof(struct flock, l_whence) == 2 && offsetof(struct flock, l_start) == 8 && offsetof(struct flock, l_len) == 16 && offsetof(struct flock, l_pid) == 24, "slicc.fcntl_lock struct flock layout");

int fcntl(int fildes, int cmd, ...) {
  switch (cmd) {
    case F_GETFD: {
      __wasi_fdflagsext_t flags;
      __wasi_errno_t error = __wasi_fd_fdflags_get(fildes, &flags);
      if (error != 0) {
        errno = error;
        return -1;
      }
      return flags & __WASI_FDFLAGSEXT_CLOEXEC ? FD_CLOEXEC : 0;
    }
    case F_SETFD: {
      va_list ap;
      va_start(ap, cmd);
      int flags = va_arg(ap, int);
      va_end(ap);

      /* Homescoop fix: `|` binds tighter than `?:`, so the upstream
       * `flags | FD_CLOEXEC ? ... : 0` is always true and EVERY F_SETFD
       * (including clear-with-0) sets CLOEXEC — stdio then vanishes on exec.
       * Correct test is (flags & FD_CLOEXEC). Upstream wasix-libc main still
       * has the bug; do not report upstream (project rule). */
      __wasi_fdflagsext_t fd_flags =
          (flags & FD_CLOEXEC) ? __WASI_FDFLAGSEXT_CLOEXEC : 0;
      __wasi_errno_t error =
          __wasi_fd_fdflags_set(fildes, fd_flags);
      if (error != 0) {
        errno = error;
        return -1;
      }
      return 0;
    }
    case F_GETFL: {
      // Obtain the flags and the rights of the descriptor.
      __wasi_fdstat_t fds;
      __wasi_errno_t error = __wasi_fd_fdstat_get(fildes, &fds);
      if (error != 0) {
        errno = error;
        return -1;
      }

      // Roughly approximate the access mode by converting the rights.
      int oflags = fds.fs_flags;
      if ((fds.fs_rights_base &
           (__WASI_RIGHTS_FD_READ | __WASI_RIGHTS_FD_READDIR)) != 0) {
        if ((fds.fs_rights_base & __WASI_RIGHTS_FD_WRITE) != 0)
          oflags |= O_RDWR;
        else
          oflags |= O_RDONLY;
      } else if ((fds.fs_rights_base & __WASI_RIGHTS_FD_WRITE) != 0) {
        oflags |= O_WRONLY;
      } else {
        oflags |= O_SEARCH;
      }
      return oflags;
    }
    case F_SETFL: {
      // Set new file descriptor flags.
      va_list ap;
      va_start(ap, cmd);
      int flags = va_arg(ap, int);
      va_end(ap);

      __wasi_fdflags_t fs_flags = flags & 0xfff;
      __wasi_errno_t error =
          __wasi_fd_fdstat_set_flags(fildes, fs_flags);
      if (error != 0) {
        errno = error;
        return -1;
      }
      return 0;
    }
    case F_DUPFD:
    case F_DUPFD_CLOEXEC: {
      va_list ap;
      va_start(ap, cmd);
      int min_res_fd = va_arg(ap, int);
      va_end(ap);

      int fd;
      __wasi_bool_t cloexec = cmd == F_DUPFD_CLOEXEC;
      __wasi_errno_t error = __wasi_fd_dup2(fildes, min_res_fd, cloexec, &fd);
      if (error != 0) {
        errno = error;
        return -1;
      }
      return fd;
    }
    case F_GETLK:
    case F_SETLK:
    case F_SETLKW: {
      va_list ap;
      va_start(ap, cmd);
      struct flock *fl = va_arg(ap, struct flock *);
      va_end(ap);
      if (fl->l_type != F_RDLCK && fl->l_type != F_WRLCK && fl->l_type != F_UNLCK) {
        errno = EINVAL;
        return -1;
      }
      int32_t err = __slicc_fcntl_lock(fildes, cmd, (int32_t)(uintptr_t)fl);
      if (err == ENOSYS) {
        __wasi_fdstat_t fds;
        __wasi_errno_t error = __wasi_fd_fdstat_get(fildes, &fds);
        if (error != 0) {
          errno = error;
          return -1;
        }
        if (cmd == F_GETLK) fl->l_type = F_UNLCK;
        return 0;
      }
      if (err != 0) {
        errno = err;
        return -1;
      }
      return 0;
    }
    default:
      errno = EINVAL;
      return -1;
  }
}
