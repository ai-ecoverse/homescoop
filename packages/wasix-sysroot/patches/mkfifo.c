/* homescoop -34 (homescoop#878): mkfifo, mkfifoat, mknod, mknodat through
 * slicc-kernel's slicc_fs.path_mkfifo(dirfd, path, path_len, mode) -> errno
 * (slicc-kernel#957, 1.120.0). The kernel applies the umask, answers EEXIST
 * for any existing name (a FIFO or a dangling link too) and doesn't follow a
 * last-component symlink. wasix-libc had none of these symbols (WASI has no
 * FIFO). A kernel without the import answers ENOSYS, which comes back as -1
 * ENOSYS: there is no other way to make a FIFO.
 *
 * mknod: S_IFIFO is mkfifo; S_IFREG (or no type) creates an empty regular
 * file as Linux does (open O_CREAT|O_EXCL); character and block devices and
 * sockets are EPERM, as for an unprivileged Linux process. */
#include <errno.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <wasi/libc-find-relpath.h>

__attribute__((import_module("slicc_fs"), import_name("path_mkfifo")))
int __slicc_fs_path_mkfifo(int dirfd, const char *path, int path_len, int mode);

static int mkfifo_at(int dirfd, const char *path, mode_t mode) {
  size_t len = 0;
  while (path[len]) len++;
  int e = __slicc_fs_path_mkfifo(dirfd, path, (int)len, (int)(mode & 07777));
  if (e == 0) return 0;
  errno = e;
  return -1;
}

static int mkfifo_path(const char *path, mode_t mode) {
  static __thread char *buf = NULL;
  static __thread size_t buf_len = 0;
  const char *abs;
  int dirfd = __wasilibc_find_relpath_alloc(path, &abs, &buf, &buf_len, 1);
  if (dirfd == -1) {
    errno = ENOENT;
    return -1;
  }
  return mkfifo_at(dirfd, buf, mode);
}

int mkfifo(const char *path, mode_t mode) {
  return mkfifo_path(path, mode);
}

int mkfifoat(int fd, const char *path, mode_t mode) {
  if (fd == AT_FDCWD || path[0] == '/') return mkfifo_path(path, mode);
  return mkfifo_at(fd, path, mode);
}

int mknodat(int fd, const char *path, mode_t mode, dev_t dev) {
  (void)dev;
  switch (mode & S_IFMT) {
  case S_IFIFO:
    return mkfifoat(fd, path, mode);
  case 0:
  case S_IFREG: {
    int f = openat(fd, path, O_CREAT | O_EXCL | O_WRONLY | O_CLOEXEC, mode & 07777);
    if (f < 0) return -1;
    close(f);
    return 0;
  }
  case S_IFCHR:
  case S_IFBLK:
  case S_IFSOCK:
    errno = EPERM;
    return -1;
  default:
    errno = EINVAL;
    return -1;
  }
}

int mknod(const char *path, mode_t mode, dev_t dev) {
  return mknodat(AT_FDCWD, path, mode, dev);
}
