/* Emscripten stubs for symbols procps probes as present but musl/emsdk lack. */
#include <errno.h>
#include <signal.h>
#include <sys/types.h>
#include <unistd.h>

struct utmp;

void setutent(void) {}
struct utmp *getutent(void) { return 0; }
void endutent(void) {}

#ifndef __SIGQUEUE_STUB__
int sigqueue(pid_t pid, int sig, const union sigval value) {
  (void)value;
  return kill(pid, sig);
}
#endif
