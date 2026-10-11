#include <errno.h>
#include <fcntl.h>
#include <stddef.h>
#include <unistd.h>
#include <wasi/libc-find-relpath.h>

#define SLICC_FS(name) __attribute__((import_module("slicc_fs"), import_name(#name)))
#define SLICC_FS_NOFOLLOW 1
SLICC_FS(path_chown) int __slicc_fs_path_chown(int dirfd, const char *path, int path_len, int uid, int gid, int flags);
SLICC_FS(fd_chown) int __slicc_fs_fd_chown(int fd, int uid, int gid);

static int upstream(uid_t uid, gid_t gid) {
  if ((uid == 0 || uid == (uid_t)-1) && (gid == 0 || gid == (gid_t)-1)) return 0;
  errno = ENOSYS;
  return -1;
}

static int result(int e, uid_t uid, gid_t gid) {
  if (e == 0) return 0;
  if (e == ENOSYS) return upstream(uid, gid);
  errno = e;
  return -1;
}

static int chown_at(int dirfd, const char *path, uid_t uid, gid_t gid, int nofollow) {
  size_t len = 0;
  while (path[len]) len++;
  return result(__slicc_fs_path_chown(dirfd, path, (int)len, (int)uid, (int)gid, nofollow ? SLICC_FS_NOFOLLOW : 0), uid, gid);
}

static int chown_path(const char *path, uid_t uid, gid_t gid, int nofollow) {
  static __thread char *buf = NULL;
  static __thread size_t buf_len = 0;
  const char *abs;
  int dirfd = __wasilibc_find_relpath_alloc(path, &abs, &buf, &buf_len, 1);
  if (dirfd == -1) {
    errno = ENOENT;
    return -1;
  }
  return chown_at(dirfd, buf, uid, gid, nofollow);
}

int chown(const char *path, uid_t uid, gid_t gid) {
  return chown_path(path, uid, gid, 0);
}

int lchown(const char *path, uid_t uid, gid_t gid) {
  return chown_path(path, uid, gid, 1);
}

int fchown(int fd, uid_t uid, gid_t gid) {
  return result(__slicc_fs_fd_chown(fd, (int)uid, (int)gid), uid, gid);
}

int fchownat(int fd, const char *path, uid_t uid, gid_t gid, int flag) {
  if (flag & ~AT_SYMLINK_NOFOLLOW) {
    errno = EINVAL;
    return -1;
  }
  int nofollow = (flag & AT_SYMLINK_NOFOLLOW) != 0;
  if (fd == AT_FDCWD || path[0] == '/') return chown_path(path, uid, gid, nofollow);
  return chown_at(fd, path, uid, gid, nofollow);
}
