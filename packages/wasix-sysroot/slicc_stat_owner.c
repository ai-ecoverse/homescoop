/*
 * SLICC realm file ownership: WASI filestat has no owner fields, so
 * wasix-libc's to_public_stat leaves st_uid/st_gid at 0. That disagrees
 * with slicc_identity.c (getuid/getgid → 1000) and breaks GnuPG safe
 * homedir checks, git safe.directory, ssh, etc.
 *
 * Replaces fstat.o + fstatat.o in every libc.a. Public stat/lstat/fstatat
 * all funnel through __wasilibc_nocwd_fstatat (posix.c / at_fdcwd.c).
 * chown/fchown remain the upstream no-ops.
 *
 * WASI filestat has no mode either. slicc-kernel's slicc_fs imports
 * (homescoop#169, slicc-kernel#208) report the permission bits; on a kernel
 * without them (ENOSYS) st_mode keeps only the file type, as upstream.
 */
#include <errno.h>
#include <fcntl.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#include <wasi/api.h>

#define NSEC_PER_SEC 1000000000ull

#define SLICC_FS(name) __attribute__((import_module("slicc_fs"), import_name(#name)))
SLICC_FS(fd_mode) int __slicc_fs_fd_mode(int fd, int *mode);
SLICC_FS(path_mode) int __slicc_fs_path_mode(int dirfd, const char *path, int path_len, int flags, int *mode);

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

/* wasix-sysroot -21: slicc_fs's mode may carry the file type, in Linux
 * numbering. WASI has no FIFO filetype, so a pipe's S_IFIFO (slicc-kernel
 * fd_mode on a pipe) can only come from there. Map Linux's type bits to
 * WASIX's __mode_t.h (FIFO 0o010000 -> 0o140000, socket 0o140000 ->
 * 0o160000; the rest are equal) and let them replace the WASI filetype; a
 * mode without type bits (older kernels) keeps the WASI one. */
static void apply_slicc_mode(struct stat *buf, int mode) {
  mode_t type;
  switch (mode & 0170000) {
  case 0010000: type = S_IFIFO; break;
  case 0020000: type = S_IFCHR; break;
  case 0040000: type = S_IFDIR; break;
  case 0060000: type = S_IFBLK; break;
  case 0100000: type = S_IFREG; break;
  case 0120000: type = S_IFLNK; break;
  case 0140000: type = S_IFSOCK; break;
  default: type = 0; break;
  }
  if (type) buf->st_mode = type | (mode_t)(mode & 07777);
  else buf->st_mode |= (mode_t)(mode & 07777);
}

int fstat(int fildes, struct stat *buf) {
  __wasi_filestat_t internal_stat;
  __wasi_errno_t error = __wasi_fd_filestat_get(((__wasi_fd_t)fildes), &internal_stat);
  if (error != 0) {
    errno = (int)error;
    return -1;
  }
  to_public_stat_owned(&internal_stat, buf);
  int mode;
  if (__slicc_fs_fd_mode(fildes, &mode) == 0)
    apply_slicc_mode(buf, mode);
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
  int mode;
  if (__slicc_fs_path_mode(fd, path, (int)strlen(path),
                           (flag & AT_SYMLINK_NOFOLLOW) ? 1 : 0, &mode) == 0)
    apply_slicc_mode(buf, mode);
  return 0;
}
