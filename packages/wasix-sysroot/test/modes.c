// File modes through slicc_fs (homescoop#169): run as `modes <dir>`, then
// read the modes from outside (test/modes.mjs) — WASI stat has no mode bits.
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

__attribute__((import_module("slicc_fs"), import_name("umask")))
int __slicc_fs_umask(int mask, int *old);

#define CHECK(call) do { if ((call) < 0) { perror(#call); return 1; } } while (0)

int main(int argc, char **argv) {
  int probe;
  printf("slicc_fs %s\n", __slicc_fs_umask(022, &probe) == ENOSYS ? "absent" : "native");
  CHECK(chdir(argc > 1 ? argv[1] : "."));
  mode_t old = umask(027);
  printf("umask old=%03o\n", (unsigned)old);
  int fd;
  CHECK(fd = open("grp", O_CREAT | O_WRONLY, 0666));            // 640
  close(fd);
  umask(022);
  CHECK(fd = open("secret", O_CREAT | O_WRONLY | O_TRUNC, 0600)); // 600
  close(fd);
  CHECK(fd = open("excl", O_CREAT | O_EXCL | O_WRONLY, 0640));  // 640
  close(fd);
  CHECK(mkdir("private", 0700));                                 // 700
  int dfd;
  CHECK(dfd = open(".", O_RDONLY | O_DIRECTORY));
  CHECK(fd = openat(dfd, "private/key", O_CREAT | O_WRONLY, 0600)); // 600
  close(fd);
  CHECK(fd = openat(dfd, "pub", O_CREAT | O_WRONLY, 0600));
  CHECK(fchmod(fd, 0644));                                       // 644
  close(fd);
  CHECK(fd = open("exec", O_CREAT | O_WRONLY, 0600));
  close(fd);
  CHECK(chmod("exec", 0755));                                    // 755
  CHECK(fd = open("exec", O_CREAT | O_WRONLY, 0600));            // stays 755
  close(fd);
  CHECK(mkdirat(dfd, "sub", 0777));                              // 755
  CHECK(mkdirat(dfd, "sub/inner", 0750));                        // 750
  CHECK(fchmodat(AT_FDCWD, "sub/inner", 0700, 0));               // 700
  CHECK(symlink("secret", "link"));
  errno = 0;
  int r = fchmodat(AT_FDCWD, "link", 0644, AT_SYMLINK_NOFOLLOW);
  printf("nofollow link: %s\n", r == 0 ? "ok" : strerror(errno));
  errno = 0;
  r = chmod("missing", 0600);
  printf("chmod missing: %s\n", r == 0 ? "ok" : strerror(errno));
  return 0;
}
