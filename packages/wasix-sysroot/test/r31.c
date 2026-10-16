#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <pthread.h>
#include <semaphore.h>
#include <signal.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>

static double now(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec + t.tv_nsec / 1e9;
}

static void show(const char *what, int r, struct sockaddr_un *a, socklen_t len) {
  if (r < 0) {
    printf("%s: -1 %s\n", what, strerror(errno));
    return;
  }
  int plen = len > offsetof(struct sockaddr_un, sun_path) ? (int)(len - offsetof(struct sockaddr_un, sun_path)) : 0;
  printf("%s: family=%s len=%s path=%s\n", what, a->sun_family == AF_UNIX ? "AF_UNIX" : a->sun_family == 0 ? "0" : "other",
         len == (socklen_t)(offsetof(struct sockaddr_un, sun_path) + strlen(a->sun_path) + 1) ? "path+1" : len == sizeof(sa_family_t) ? "family" : "other",
         plen ? a->sun_path : "-");
}

static void unix_addrs(void) {
  const char *path = "/tmp/r31.sock";
  unlink(path);
  int s = socket(AF_UNIX, SOCK_STREAM, 0);
  struct sockaddr_un a = {.sun_family = AF_UNIX};
  strcpy(a.sun_path, path);
  if (bind(s, (struct sockaddr *)&a, sizeof a) || listen(s, 1)) {
    printf("bind/listen: -1 %s\n", strerror(errno));
    return;
  }
  struct sockaddr_un g;
  socklen_t gl = sizeof g;
  memset(&g, 0x55, sizeof g);
  show("getsockname", getsockname(s, (struct sockaddr *)&g, &gl), &g, gl);
  int c = socket(AF_UNIX, SOCK_STREAM, 0);
  if (connect(c, (struct sockaddr *)&a, sizeof a)) {
    printf("connect: -1 %s\n", strerror(errno));
    return;
  }
  memset(&g, 0x55, sizeof g);
  gl = sizeof g;
  int x = accept(s, (struct sockaddr *)&g, &gl);
  show("accept peer", x, &g, gl);
  memset(&g, 0x55, sizeof g);
  gl = sizeof g;
  show("client getpeername", getpeername(c, (struct sockaddr *)&g, &gl), &g, gl);
  memset(&g, 0x55, sizeof g);
  gl = sizeof g;
  show("client getsockname", getsockname(c, (struct sockaddr *)&g, &gl), &g, gl);
  memset(&g, 0x55, sizeof g);
  gl = 4;
  int r = getsockname(s, (struct sockaddr *)&g, &gl);
  printf("short buffer: %d family=%s len=%s untouched=%d\n", r, g.sun_family == AF_UNIX ? "AF_UNIX" : "other", gl == offsetof(struct sockaddr_un, sun_path) + strlen(path) + 1 ? "full" : "other", ((unsigned char *)&g)[4] == 0x55);
  close(x);
  close(c);
  close(s);
  unlink(path);
}

static void *close_later(void *arg) {
  usleep(300000);
  close(*(int *)arg);
  return NULL;
}

static void late(const char *n, int pp, int watch_write) {
  static int a[2];
  pipe(a);
  if (!watch_write) write(a[1], "x", 1);
  struct pollfd e = {watch_write ? a[1] : a[0], 0, 0};
  pthread_t t;
  pthread_create(&t, NULL, close_later, watch_write ? &a[0] : &a[1]);
  double t0 = now();
  struct timespec three = {3, 0};
  int r = pp ? ppoll(&e, 1, &three, NULL) : poll(&e, 1, 3000);
  double dt = now() - t0;
  pthread_join(t, NULL);
  printf("%s events0 %s, peer closes later: %d revents=%s %s\n", n, watch_write ? "writable write end" : "readable read end", r,
         e.revents == POLLERR ? "POLLERR" : e.revents == POLLHUP ? "POLLHUP" : e.revents ? "other" : "0", dt >= 0.25 && dt < 1.5 ? "in time" : "wrong");
  close(watch_write ? a[1] : a[0]);
}

static void hangup(void) {
  for (int pp = 0; pp < 2; pp++) {
    const char *n = pp ? "ppoll" : "poll";
    int a[2];
    pipe(a);
    close(a[1]);
    struct pollfd h = {a[0], 0, 0};
    double t0 = now();
    struct timespec two = {2, 0};
    int r = pp ? ppoll(&h, 1, &two, NULL) : poll(&h, 1, 2000);
    printf("%s events0 hup: %d revents=%s %s\n", n, r, h.revents == POLLHUP ? "POLLHUP" : h.revents ? "other" : "0", now() - t0 < 1 ? "fast" : "slow");
    close(a[0]);
    pipe(a);
    write(a[1], "x", 1);
    struct pollfd q[2] = {{a[0], 0, 0}, {a[1], 0, 0}};
    t0 = now();
    struct timespec ms300 = {0, 300000000};
    r = pp ? ppoll(q, 2, &ms300, NULL) : poll(q, 2, 300);
    double dt = now() - t0;
    printf("%s events0 readable/writable: %d revents=%d,%d %s\n", n, r, q[0].revents, q[1].revents, dt >= 0.25 && dt < 2 ? "waited" : "wrong");
    close(a[1]);
    struct pollfd w = {a[0], POLLIN, 0};
    r = pp ? ppoll(&w, 1, &ms300, NULL) : poll(&w, 1, 300);
    printf("%s pollin after close: %d revents=%s\n", n, r, w.revents == (POLLIN | POLLHUP) ? "POLLIN|POLLHUP" : "other");
    close(a[0]);
    pipe(a);
    close(a[0]);
    struct pollfd e = {a[1], 0, 0};
    r = pp ? ppoll(&e, 1, &two, NULL) : poll(&e, 1, 2000);
    printf("%s events0 write end, reader gone: %d revents=%s\n", n, r, e.revents == POLLERR ? "POLLERR" : e.revents == POLLHUP ? "POLLHUP" : e.revents ? "other" : "0");
    close(a[1]);
    late(n, pp, 1);
    late(n, pp, 0);
  }
}

static void many_sems(void) {
  enum { N = 1000 };
  char name[32];
  static sem_t *s[N];
  int opened = 0, good = 0;
  for (int i = 0; i < N; i++) {
    snprintf(name, sizeof name, "/r31m%d", i);
    sem_unlink(name);
    s[i] = sem_open(name, O_CREAT | O_EXCL, 0600, i % 7);
    if (s[i] == SEM_FAILED) {
      printf("sems: stopped at %d: %s\n", i, strerror(errno));
      break;
    }
    opened++;
  }
  for (int i = 0; i < opened; i++) {
    int v = -1;
    if (sem_getvalue(s[i], &v) == 0 && v == i % 7) good++;
  }
  int closed = 0;
  for (int i = 0; i < opened; i++) {
    snprintf(name, sizeof name, "/r31m%d", i);
    if (sem_close(s[i]) == 0 && sem_unlink(name) == 0) closed++;
  }
  printf("sems: opened %d, values right %d, closed+unlinked %d\n", opened, good, closed);
}

int main(int argc, char **argv) {
  (void)argc; (void)argv;
  setvbuf(stdout, NULL, _IONBF, 0);
  unix_addrs();
  hangup();
  sem_t *probe = sem_open("/r31probe", O_CREAT, 0600, 0);
  if (probe != SEM_FAILED) {
    sem_close(probe);
    sem_unlink("/r31probe");
    many_sems();
  } else {
    printf("sems: no kernel semaphores (%s)\n", strerror(errno));
  }
  printf("r31 done\n");
  return 0;
}
