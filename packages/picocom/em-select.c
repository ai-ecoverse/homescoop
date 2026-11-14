#include <stddef.h>
#include <sys/select.h>
#include <time.h>

int homescoop_picocom_select(int n, fd_set *rfds, fd_set *wfds, fd_set *efds, struct timeval *tv) {
  struct timespec ts;
  struct timespec *tsp = NULL;
  if (tv) {
    ts.tv_sec = tv->tv_sec;
    ts.tv_nsec = tv->tv_usec * 1000;
    tsp = &ts;
  }
  return pselect(n, rfds, wfds, efds, tsp, NULL);
}
