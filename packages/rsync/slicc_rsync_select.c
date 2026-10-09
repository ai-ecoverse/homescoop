/*
 * rsync calls select() for its I/O loop and as a sleep (--bwlimit, msleep).
 * The slicc shims replace pselect() and poll(), which wait in the kernel, but
 * not select(): Emscripten's select() never blocks, so the three rsync
 * processes spun on their pipes and --bwlimit did not throttle. rsync is
 * built with -Dselect=slicc_rsync_select; this file is compiled without it.
 */
#include <stddef.h>
#include <sys/select.h>
#include <time.h>

int slicc_rsync_select(int n, fd_set *rfds, fd_set *wfds, fd_set *efds, struct timeval *tv) {
  struct timespec ts;
  if (tv) {
    ts.tv_sec = tv->tv_sec;
    ts.tv_nsec = tv->tv_usec * 1000L;
  }
  return pselect(n, rfds, wfds, efds, tv ? &ts : NULL, NULL);
}
