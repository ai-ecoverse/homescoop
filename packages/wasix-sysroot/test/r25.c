#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static const char *err(int r) {
  if (r >= 0) return "0";
  switch (errno) {
  case EACCES: return "EACCES";
  case ENOENT: return "ENOENT";
  case EINVAL: return "EINVAL";
  case EPERM: return "EPERM";
  default: return strerror(errno);
  }
}

static void acc(const char *label, int r) {
  printf("%s: %s\n", label, err(r));
  errno = 0;
}

static void opn(const char *label, const char *path, int flags) {
  errno = 0;
  int fd = open(path, flags);
  printf("%s: %s\n", label, err(fd));
  if (fd >= 0) close(fd);
}

static int setup(void) {
  mkdir("/tmp/r25", 0755);
  mkdir("/tmp/r25/closed", 0700);
  const char *files[][2] = {{"/tmp/r25/ro", "0444"}, {"/tmp/r25/rw", "0644"}, {"/tmp/r25/x", "0755"}, {"/tmp/r25/priv", "0600"}, {"/tmp/r25/closed/f", "0644"}};
  for (unsigned i = 0; i < sizeof files / sizeof *files; i++) {
    int fd = open(files[i][0], O_CREAT | O_WRONLY | O_TRUNC, 0644);
    if (fd < 0) { perror(files[i][0]); return 1; }
    close(fd);
    chmod(files[i][0], (mode_t)strtol(files[i][1], NULL, 8));
  }
  chmod("/tmp/r25", 0755);
  chmod("/tmp/r25/closed", 0700);
  unlink("/tmp/r25/link");
  symlink("priv", "/tmp/r25/link");
  printf("setup done\n");
  return 0;
}

static void common(void) {
  acc("ro R", access("/tmp/r25/ro", R_OK));
  acc("ro W", access("/tmp/r25/ro", W_OK));
  acc("ro X", access("/tmp/r25/ro", X_OK));
  acc("rw W", access("/tmp/r25/rw", W_OK));
  acc("x X", access("/tmp/r25/x", X_OK));
  acc("priv R", access("/tmp/r25/priv", R_OK));
  acc("priv F", access("/tmp/r25/priv", F_OK));
  acc("closed/f F", access("/tmp/r25/closed/f", F_OK));
  acc("link nofollow R", faccessat(AT_FDCWD, "/tmp/r25/link", R_OK, AT_SYMLINK_NOFOLLOW));
  acc("link follow R", faccessat(AT_FDCWD, "/tmp/r25/link", R_OK, 0));
  int dfd = open("/tmp/r25", O_RDONLY | O_DIRECTORY);
  acc("dirfd priv R", faccessat(dfd, "priv", R_OK, 0));
  close(dfd);
  acc("eaccess priv R", eaccess("/tmp/r25/priv", R_OK));
  acc("bad flag", faccessat(AT_FDCWD, "/tmp/r25/ro", R_OK, 0x8));
  acc("bad mode", access("/tmp/r25/ro", 0x10));
  acc("missing", access("/tmp/r25/missing", F_OK));
  opn("open ro RDONLY", "/tmp/r25/ro", O_RDONLY);
  opn("open rw WRONLY", "/tmp/r25/rw", O_WRONLY);
  opn("open rw RDWR", "/tmp/r25/rw", O_RDWR);
  opn("open priv RDONLY", "/tmp/r25/priv", O_RDONLY);
  DIR *d = opendir("/tmp/r25");
  printf("opendir: %s\n", d ? "0" : err(-1));
  if (d) closedir(d);
}

int main(int argc, char **argv) {
  setvbuf(stdout, NULL, _IONBF, 0);
  if (argc > 1 && !strcmp(argv[1], "setup")) return setup();
  common();
  if (argc > 1 && !strcmp(argv[1], "root")) {
    errno = 0;
    int s = seteuid(1000);
    printf("seteuid 1000: %s\n", err(s));
    acc("real priv R", access("/tmp/r25/priv", R_OK));
    acc("effective priv R", eaccess("/tmp/r25/priv", R_OK));
    acc("effective at priv R", faccessat(AT_FDCWD, "/tmp/r25/priv", R_OK, AT_EACCESS));
    seteuid(0);
  }
  printf("r25 done\n");
  return 0;
}
