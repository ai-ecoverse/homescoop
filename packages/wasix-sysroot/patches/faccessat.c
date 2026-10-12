#include <wasi/api.h>
#include <errno.h>
#include <fcntl.h>
#include <string.h>
#include <unistd.h>

#define SLICC_FS(name) __attribute__((import_module("slicc_fs"), import_name(#name)))
#define SLICC_FS_NOFOLLOW 1
#define SLICC_FS_EACCESS 2
#define HOMESCOOP_AT_EACCESS 0x200
SLICC_FS(path_access) int __slicc_fs_path_access(int dirfd, const char *path, int path_len, int amode, int flags);

static int access_absent;

static int stat_access(int fd, const char *path, int amode, int nofollow) {
  __wasi_lookupflags_t lookup_flags = nofollow ? 0 : __WASI_LOOKUPFLAGS_SYMLINK_FOLLOW;
  __wasi_filestat_t file;
  __wasi_errno_t error = __wasi_path_filestat_get(fd, lookup_flags, path, &file);
  if (error != 0) {
    errno = error;
    return -1;
  }
  if (amode != 0) {
    __wasi_fdstat_t directory;
    error = __wasi_fd_fdstat_get(fd, &directory);
    if (error != 0) {
      errno = error;
      return -1;
    }
    __wasi_rights_t min = 0;
    if ((amode & R_OK) != 0)
      min |= file.filetype == __WASI_FILETYPE_DIRECTORY ? __WASI_RIGHTS_FD_READDIR : __WASI_RIGHTS_FD_READ;
    if ((amode & W_OK) != 0)
      min |= __WASI_RIGHTS_FD_WRITE;
    if ((min & directory.fs_rights_inheriting) != min) {
      errno = EACCES;
      return -1;
    }
  }
  return 0;
}

int __wasilibc_nocwd_faccessat(int fd, const char *path, int amode, int flag) {
  if ((amode & ~(F_OK | R_OK | W_OK | X_OK)) != 0 ||
      (flag & ~(AT_EACCESS | HOMESCOOP_AT_EACCESS | AT_SYMLINK_NOFOLLOW)) != 0) {
    errno = EINVAL;
    return -1;
  }
  int nofollow = (flag & AT_SYMLINK_NOFOLLOW) != 0;
  if (!__atomic_load_n(&access_absent, __ATOMIC_RELAXED)) {
    int flags = (nofollow ? SLICC_FS_NOFOLLOW : 0) | ((flag & HOMESCOOP_AT_EACCESS) ? SLICC_FS_EACCESS : 0);
    int e = __slicc_fs_path_access(fd, path, (int)strlen(path), amode, flags);
    if (e == 0) return 0;
    if (e != ENOSYS) {
      errno = e;
      return -1;
    }
    __atomic_store_n(&access_absent, 1, __ATOMIC_RELAXED);
  }
  return stat_access(fd, path, amode, nofollow);
}

int euidaccess(const char *path, int amode) {
  return faccessat(AT_FDCWD, path, amode, HOMESCOOP_AT_EACCESS);
}

int eaccess(const char *path, int amode) {
  return euidaccess(path, amode);
}
