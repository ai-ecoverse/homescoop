#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static const char *err(int r) {
  if (r == 0) return "0";
  switch (errno) {
  case EPERM: return "-1 EPERM";
  case ENOENT: return "-1 ENOENT";
  case EINVAL: return "-1 EINVAL";
  case ENOSYS: return "-1 ENOSYS";
  case EBADF: return "-1 EBADF";
  default: return strerror(errno);
  }
}

static void owner(const char *label, const char *path, int nofollow) {
  struct stat st;
  int r = nofollow ? lstat(path, &st) : stat(path, &st);
  if (r) printf("%s: stat %s\n", label, err(r));
  else printf("%s: %u:%u\n", label, (unsigned)st.st_uid, (unsigned)st.st_gid);
}

static void step(const char *label, int r, const char *path, int nofollow) {
  const char *e = err(r);
  struct stat st;
  int s = nofollow ? lstat(path, &st) : stat(path, &st);
  if (s) printf("%s: %s stat %s\n", label, e, err(s));
  else printf("%s: %s owner=%u:%u\n", label, e, (unsigned)st.st_uid, (unsigned)st.st_gid);
}

static int root(void) {
  mkdir("/tmp/r24", 0755);
  int fd = open("/tmp/r24/f", O_CREAT | O_RDWR | O_TRUNC, 0644);
  unlink("/tmp/r24/l");
  symlink("f", "/tmp/r24/l");
  owner("new", "/tmp/r24/f", 0);
  step("chown", chown("/tmp/r24/f", 1000, 1000), "/tmp/r24/f", 0);
  step("lchown", lchown("/tmp/r24/l", 1000, 100), "/tmp/r24/l", 1);
  owner("lchown target", "/tmp/r24/f", 0);
  struct stat st;
  int r = fchown(fd, 0, (gid_t)-1);
  const char *e = err(r);
  fstat(fd, &st);
  printf("fchown: %s owner=%u:%u\n", e, (unsigned)st.st_uid, (unsigned)st.st_gid);
  step("fchownat cwd", fchownat(AT_FDCWD, "/tmp/r24/f", (uid_t)-1, 0, 0), "/tmp/r24/f", 0);
  int dfd = open("/tmp/r24", O_RDONLY | O_DIRECTORY);
  step("fchownat nofollow", fchownat(dfd, "l", 1000, (gid_t)-1, AT_SYMLINK_NOFOLLOW), "/tmp/r24/l", 1);
  errno = 0;
  printf("fchownat badflag: %s\n", err(fchownat(dfd, "f", 0, 0, 0x400)));
  errno = 0;
  printf("missing: %s\n", err(chown("/tmp/r24/missing", 1000, 1000)));
  close(fd);
  printf("fchown closed: %s\n", err(fchown(fd, 1000, 1000)));
  close(dfd);
  printf("r24 root done\n");
  return 0;
}

static int user(void) {
  mkdir("/tmp/r24u", 0755);
  int fd = open("/tmp/r24u/g", O_CREAT | O_RDWR | O_TRUNC, 0644);
  owner("new", "/tmp/r24u/g", 0);
  step("give away", chown("/tmp/r24u/g", 0, (gid_t)-1), "/tmp/r24u/g", 0);
  step("own group", chown("/tmp/r24u/g", (uid_t)-1, 100), "/tmp/r24u/g", 0);
  struct stat st;
  int r = fchown(fd, (uid_t)-1, 0);
  const char *e = err(r);
  fstat(fd, &st);
  printf("foreign group: %s owner=%u:%u\n", e, (unsigned)st.st_uid, (unsigned)st.st_gid);
  owner("root file", "/tmp/r24/f", 0);
  close(fd);
  printf("r24 user done\n");
  return 0;
}

int main(int argc, char **argv) {
  setvbuf(stdout, NULL, _IONBF, 0);
  if (argc > 1 && !strcmp(argv[1], "user")) return user();
  return root();
}
