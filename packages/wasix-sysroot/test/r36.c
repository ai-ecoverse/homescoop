/* wasix-sysroot -36 probe: a ready fd wins over a pending signal the wait's
 * mask unblocks (#949), gethostname() is the kernel's node name (#1050), poll
 * on pipe ends whose peer is gone and on a socketpair end (#975). */
#define _GNU_SOURCE
#include <errno.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

static volatile int usr1;
static void on_usr1(int s) { (void)s; usr1++; }

static const char *rev(short r) {
  static char b[8][64]; static int k; char *o = b[k++ % 8]; o[0] = 0;
  if (r & POLLIN) strcat(o, "|POLLIN");
  if (r & POLLOUT) strcat(o, "|POLLOUT");
  if (r & POLLERR) strcat(o, "|POLLERR");
  if (r & POLLHUP) strcat(o, "|POLLHUP");
  if (r & POLLNVAL) strcat(o, "|POLLNVAL");
  return o[0] ? o + 1 : "0";
}

static int pending(void) { sigset_t p; sigemptyset(&p); sigpending(&p); return sigismember(&p, SIGUSR1) == 1; }

static void ready_wins(const char *n, int which) {
  int p[2]; pipe(p); write(p[1], "x", 1);
  sigset_t empty; sigemptyset(&empty);
  usr1 = 0;
  kill(getpid(), SIGUSR1); /* blocked: pending */
  int r = -1, e = 0;
  if (which == 0) {
    struct pollfd f = { p[0], POLLIN, 0 };
    struct timespec t = { 2, 0 };
    r = ppoll(&f, 1, &t, &empty); e = errno;
  } else if (which == 1) {
    fd_set rs; FD_ZERO(&rs); FD_SET(p[0], &rs);
    struct timespec t = { 2, 0 };
    r = pselect(p[0] + 1, &rs, NULL, NULL, &t, &empty); e = errno;
  } else {
    int ep = epoll_create1(0);
    struct epoll_event in = { .events = EPOLLIN, .data.u64 = 7 }, out[2];
    epoll_ctl(ep, EPOLL_CTL_ADD, p[0], &in);
    r = epoll_pwait(ep, out, 2, 2000, &empty); e = errno;
    close(ep);
  }
  int was_pending = pending();
  /* unblock to drain: the handler runs now */
  sigset_t s; sigemptyset(&s); sigaddset(&s, SIGUSR1);
  sigprocmask(SIG_UNBLOCK, &s, NULL);
  int ran = usr1;
  sigprocmask(SIG_BLOCK, &s, NULL);
  printf("%s ready + pending SIGUSR1: %d%s pending_after=%d handler_after_unblock=%d\n", n, r, r < 0 ? (e == EINTR ? " EINTR" : " err") : "", was_pending, ran);
  close(p[0]); close(p[1]);
}

int main(void) {
  setvbuf(stdout, NULL, _IONBF, 0);
  signal(SIGPIPE, SIG_IGN);
  struct sigaction sa; memset(&sa, 0, sizeof sa); sa.sa_handler = on_usr1; sigaction(SIGUSR1, &sa, NULL);
  sigset_t s; sigemptyset(&s); sigaddset(&s, SIGUSR1); sigprocmask(SIG_BLOCK, &s, NULL);
  ready_wins("ppoll", 0);
  ready_wins("pselect", 1);
  ready_wins("epoll_pwait", 2);

  char h[256] = {0};
  int r = gethostname(h, sizeof h);
  const char *env = getenv("HOSTNAME");
  printf("gethostname: %d %s (HOSTNAME %s)\n", r, env && !strcmp(h, env) ? "= HOSTNAME" : h, env ? "set" : "unset");

  int q[2];
  pipe(q); close(q[0]);
  struct pollfd p = { q[1], POLLOUT | POLLIN, 0 };
  r = poll(&p, 1, 100);
  printf("poll POLLIN|POLLOUT on a write end, reader gone: %d revents=%s\n", r, rev(p.revents));
  close(q[1]);
  pipe(q); close(q[1]);
  p = (struct pollfd){ q[0], POLLIN, 0 };
  r = poll(&p, 1, 100);
  printf("poll POLLIN on an empty read end, writer gone: %d revents=%s\n", r, rev(p.revents));
  close(q[0]);
  pipe(q); write(q[1], "x", 1); close(q[1]);
  p = (struct pollfd){ q[0], POLLIN, 0 };
  r = poll(&p, 1, 100);
  printf("poll POLLIN on a read end with data, writer gone: %d revents=%s\n", r, rev(p.revents));
  close(q[0]);
  int sv[2];
  socketpair(AF_UNIX, SOCK_STREAM, 0, sv); close(sv[1]);
  p = (struct pollfd){ sv[0], POLLIN, 0 };
  r = poll(&p, 1, 100);
  printf("poll POLLIN on a socketpair end, peer closed, empty: %d revents=%s\n", r, rev(p.revents));
  close(sv[0]);
  socketpair(AF_UNIX, SOCK_STREAM, 0, sv); shutdown(sv[1], SHUT_WR);
  p = (struct pollfd){ sv[0], POLLIN, 0 };
  r = poll(&p, 1, 100);
  printf("poll POLLIN on a socketpair end, peer SHUT_WR: %d revents=%s\n", r, rev(p.revents));
  close(sv[0]); close(sv[1]);
  socketpair(AF_UNIX, SOCK_STREAM, 0, sv); close(sv[1]);
  p = (struct pollfd){ sv[0], POLLOUT, 0 };
  r = poll(&p, 1, 100);
  printf("poll POLLOUT on a socketpair end, peer closed: %d revents=%s\n", r, rev(p.revents));
  close(sv[0]);
  printf("r36 done\n");
  return 0;
}
