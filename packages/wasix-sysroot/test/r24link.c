#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static ino_t ino_of(const char *p) {
  struct stat st;
  return stat(p, &st) ? 0 : st.st_ino;
}

static void report(const char *label, int r, const char *path) {
  int e = errno;
  struct stat st, ls;
  ino_t want = ino_of("/tmp/r24l/q2");
  if (r) {
    printf("%s: -1 %s\n", label, e == ENOENT ? "ENOENT" : e == EEXIST ? "EEXIST" : e == EPERM ? "EPERM" : strerror(e));
    return;
  }
  if (lstat(path, &ls)) { printf("%s: 0 but lstat failed\n", label); return; }
  stat(path, &st);
  printf("%s: 0 %s same=%d\n", label, S_ISLNK(ls.st_mode) ? "symlink" : S_ISREG(ls.st_mode) ? "file" : "other", st.st_ino == want);
}

int main(int argc, char **argv) {
  setvbuf(stdout, NULL, _IONBF, 0);
  const char *dir = argc > 1 ? argv[1] : "/tmp/r24l";
  mkdir(dir, 0755);
  if (chdir(dir)) { perror("chdir"); return 1; }
  const char *names[] = {"q1", "q3", "q4", "q5", "q6", "q7", "q8", "s"};
  for (unsigned i = 0; i < sizeof names / sizeof *names; i++) unlink(names[i]);
  int fd = open("q2", O_CREAT | O_WRONLY | O_TRUNC, 0644);
  write(fd, "x\n", 2);
  close(fd);
  symlink("q2", "s");
  int dfd = open(".", O_RDONLY | O_DIRECTORY);
  errno = 0; report("link abs", link("/tmp/r24l/q2", "/tmp/r24l/q1"), "q1");
  errno = 0; report("linkat cwd rel", linkat(AT_FDCWD, "q2", AT_FDCWD, "q3", 0), "q3");
  errno = 0; report("linkat cwd abs", linkat(AT_FDCWD, "/tmp/r24l/q2", AT_FDCWD, "/tmp/r24l/q4", 0), "q4");
  errno = 0; report("linkat follow", linkat(AT_FDCWD, "s", AT_FDCWD, "q5", AT_SYMLINK_FOLLOW), "q5");
  errno = 0; report("linkat dirfd/cwd", linkat(dfd, "q2", AT_FDCWD, "q7", 0), "q7");
  errno = 0; report("linkat cwd/dirfd", linkat(AT_FDCWD, "q2", dfd, "q8", 0), "q8");
  struct stat st;
  stat("q2", &st);
  printf("nlink=%lu\n", (unsigned long)st.st_nlink);
  close(dfd);
  printf("r24link done\n");
  return 0;
}
