/*
 * SLICC realm: every file is the realm user's (uid/gid 1000), as the kernel
 * reports for Emscripten programs (realm-user.ts). WASI's filestat has no
 * owner, so wasix-libc answers 0 — and GnuPG refuses a homedir and config
 * files it does not own. Linked with -Wl,--wrap=stat,--wrap=lstat,
 * --wrap=fstat,--wrap=fstatat; remove once wasix-sysroot does this itself.
 */
#include <sys/stat.h>
#include <unistd.h>

int __real_stat(const char *restrict, struct stat *restrict);
int __real_lstat(const char *restrict, struct stat *restrict);
int __real_fstat(int, struct stat *);
int __real_fstatat(int, const char *restrict, struct stat *restrict, int);

static int owned(int rc, struct stat *st) {
  if (rc == 0) {
    st->st_uid = getuid();
    st->st_gid = getgid();
  }
  return rc;
}

int __wrap_stat(const char *restrict path, struct stat *restrict st) {
  return owned(__real_stat(path, st), st);
}
int __wrap_lstat(const char *restrict path, struct stat *restrict st) {
  return owned(__real_lstat(path, st), st);
}
int __wrap_fstat(int fd, struct stat *st) {
  return owned(__real_fstat(fd, st), st);
}
int __wrap_fstatat(int dirfd, const char *restrict path, struct stat *restrict st, int flags) {
  return owned(__real_fstatat(dirfd, path, st, flags), st);
}
