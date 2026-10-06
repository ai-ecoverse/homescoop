/*
 * SLICC realm file ownership: WASI filestat has no owner fields, so
 * wasix-libc's to_public_stat leaves st_uid/st_gid at 0. That disagrees
 * with slicc_identity.c (getuid/getgid → 1000) and breaks GnuPG safe
 * homedir checks, git safe.directory, ssh, etc.
 *
 * Replaces fstat.o + fstatat.o in every libc.a. Public stat/lstat/fstatat
 * all funnel through __wasilibc_nocwd_fstatat (posix.c / at_fdcwd.c).
 * chown/fchown remain the upstream no-ops.
 */
#include <errno.h>
#include <fcntl.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#include <wasi/api.h>

#define NSEC_PER_SEC 1000000000ull

static struct timespec timestamp_to_timespec(__wasi_timestamp_t timestamp) {
  return (struct timespec){.tv_sec = (time_t)(timestamp / NSEC_PER_SEC),
                           .tv_nsec = (long)(timestamp % NSEC_PER_SEC)};
}

static void to_public_stat_owned(const __wasi_filestat_t *in, struct stat *out) {
  memset(out, 0, sizeof(*out));
  out->st_dev = in->dev;
  out->st_ino = in->ino;
  out->st_nlink = in->nlink;
  out->st_size = (__typeof__(out->st_size))in->size;
  out->st_atim = timestamp_to_timespec(in->atim);
  out->st_mtim = timestamp_to_timespec(in->mtim);
  out->st_ctim = timestamp_to_timespec(in->ctim);
  /* Match getuid()/getgid() from slicc_identity.c (and Emscripten realm). */
  out->st_uid = getuid();
  out->st_gid = getgid();

  switch (in->filetype) {
  case __WASI_FILETYPE_BLOCK_DEVICE:
    out->st_mode |= S_IFBLK;
    break;
  case __WASI_FILETYPE_CHARACTER_DEVICE:
    out->st_mode |= S_IFCHR;
    break;
  case __WASI_FILETYPE_DIRECTORY:
    out->st_mode |= S_IFDIR;
    break;
  case __WASI_FILETYPE_REGULAR_FILE:
    out->st_mode |= S_IFREG;
    break;
  case __WASI_FILETYPE_SOCKET_DGRAM:
  case __WASI_FILETYPE_SOCKET_STREAM:
#ifdef __WASI_FILETYPE_SOCKET_SEQPACKET
  case __WASI_FILETYPE_SOCKET_SEQPACKET:
#endif
#ifdef __WASI_FILETYPE_SOCKET_RAW
  case __WASI_FILETYPE_SOCKET_RAW:
#endif
    out->st_mode |= S_IFSOCK;
    break;
  case __WASI_FILETYPE_SYMBOLIC_LINK:
    out->st_mode |= S_IFLNK;
    break;
  default:
    break;
  }
}

int fstat(int fildes, struct stat *buf) {
  __wasi_filestat_t internal_stat;
  __wasi_errno_t error = __wasi_fd_filestat_get(((__wasi_fd_t)fildes), &internal_stat);
  if (error != 0) {
    errno = (int)error;
    return -1;
  }
  to_public_stat_owned(&internal_stat, buf);
  return 0;
}

int __wasilibc_nocwd_fstatat(int fd, const char *restrict path,
                             struct stat *restrict buf, int flag) {
  __wasi_lookupflags_t lookup_flags = 0;
  if ((flag & AT_SYMLINK_NOFOLLOW) == 0)
    lookup_flags |= __WASI_LOOKUPFLAGS_SYMLINK_FOLLOW;

  __wasi_filestat_t internal_stat;
  __wasi_errno_t error =
      __wasi_path_filestat_get((__wasi_fd_t)fd, lookup_flags, path, &internal_stat);
  if (error != 0) {
    errno = (int)error;
    return -1;
  }
  to_public_stat_owned(&internal_stat, buf);
  return 0;
}
