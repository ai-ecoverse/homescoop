#include <wasi/api.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <sys/stat.h>
#include <time.h>

static int one(const struct timespec *t, __wasi_fstflags_t set, __wasi_fstflags_t now, __wasi_timestamp_t *out, __wasi_fstflags_t *flags) {
  long nsec = t->tv_nsec;
  if (nsec == UTIME_NOW) {
    *flags |= now;
    return 1;
  }
  if (nsec == UTIME_OMIT) return 1;
  if (nsec < 0 || nsec >= 1000000000L || t->tv_sec < 0) return 0;
  if ((uint64_t)t->tv_sec > (UINT64_MAX - (uint64_t)nsec) / 1000000000ULL) return 0;
  *out = (uint64_t)t->tv_sec * 1000000000ULL + (uint64_t)nsec;
  *flags |= set;
  return 1;
}

static int timestamps(const struct timespec *times, __wasi_timestamp_t *atim, __wasi_timestamp_t *mtim, __wasi_fstflags_t *flags) {
  *atim = 0;
  *mtim = 0;
  if (times == NULL) {
    *flags = __WASI_FSTFLAGS_ATIM_NOW | __WASI_FSTFLAGS_MTIM_NOW;
    return 1;
  }
  *flags = 0;
  return one(&times[0], __WASI_FSTFLAGS_ATIM, __WASI_FSTFLAGS_ATIM_NOW, atim, flags) &&
         one(&times[1], __WASI_FSTFLAGS_MTIM, __WASI_FSTFLAGS_MTIM_NOW, mtim, flags);
}

int __wasilibc_nocwd_utimensat(int fd, const char *path, const struct timespec times[2], int flag) {
  __wasi_timestamp_t atim, mtim;
  __wasi_fstflags_t flags;
  if (!timestamps(times, &atim, &mtim, &flags)) {
    errno = EINVAL;
    return -1;
  }
  __wasi_lookupflags_t lookup = (flag & AT_SYMLINK_NOFOLLOW) ? 0 : __WASI_LOOKUPFLAGS_SYMLINK_FOLLOW;
  __wasi_errno_t error = __wasi_path_filestat_set_times(fd, lookup, path, atim, mtim, flags);
  if (error != 0) {
    errno = error;
    return -1;
  }
  return 0;
}

int futimens(int fd, const struct timespec *times) {
  __wasi_timestamp_t atim, mtim;
  __wasi_fstflags_t flags;
  if (!timestamps(times, &atim, &mtim, &flags)) {
    errno = EINVAL;
    return -1;
  }
  __wasi_errno_t error = __wasi_fd_filestat_set_times(fd, atim, mtim, flags);
  if (error != 0) {
    errno = error;
    return -1;
  }
  return 0;
}
