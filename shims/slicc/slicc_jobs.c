/*
 * Process groups, sessions and the terminal's foreground group for
 * Emscripten tools running in slicc (#3530): what a shell's job control
 * stands on.
 *
 * In the wasm realm the kernel keeps them (`Module.sliccKernel`): setpgid,
 * getpgid, getsid, setsid, and tcgetpgrp / tcsetpgrp on a kernel terminal.
 * Emscripten's own answers are single-process stubs (every process in group
 * 42) and TIOCGPGRP / TIOCSPGRP never leave its ioctl; outside the wasm realm
 * these fall back to one process that leads its own group and session.
 */
#include <emscripten.h>
#include <errno.h>
#include <sys/types.h>
#include <termios.h>
#include <unistd.h>

// Returned when there is no kernel: take the single-process answer.
#define NO_KERNEL (-0x40000000)

EM_JS(int, slicc_jobs_js, (int op, int a, int b), {
  const k = Module.sliccKernel;
  if (!k || !k.setpgid) return -0x40000000;
  switch (op) {
    case 0: return k.setpgid(a, b);
    case 1: return k.getpgid(a);
    case 2: return k.getsid(a);
    case 3: return k.setsid();
    case 4: return k.tcgetpgrp(a);
    case 5: return k.tcsetpgrp(a, b);
  }
  return -52; // ENOSYS
});

static int self_only(pid_t pid) {
  return pid == 0 || pid == getpid() ? getpid() : -ESRCH;
}

int __syscall_setpgid(pid_t pid, pid_t pgid) {
  int r = slicc_jobs_js(0, pid, pgid);
  if (r != NO_KERNEL) return r;
  r = self_only(pid);
  return r < 0 ? r : (pgid == 0 || pgid == r ? 0 : -EPERM);
}

pid_t __syscall_getpgid(pid_t pid) {
  int r = slicc_jobs_js(1, pid, 0);
  return r != NO_KERNEL ? r : self_only(pid);
}

pid_t __syscall_getsid(pid_t pid) {
  int r = slicc_jobs_js(2, pid, 0);
  return r != NO_KERNEL ? r : self_only(pid);
}

pid_t __syscall_setsid(void) {
  int r = slicc_jobs_js(3, 0, 0);
  // Already a group leader, as the one process is.
  return r != NO_KERNEL ? r : -EPERM;
}

pid_t tcgetpgrp(int fd) {
  int r = slicc_jobs_js(4, fd, 0);
  if (r == NO_KERNEL) r = isatty(fd) ? getpid() : -ENOTTY;
  if (r < 0) {
    errno = -r;
    return -1;
  }
  return r;
}

int tcsetpgrp(int fd, pid_t pgrp) {
  int r = slicc_jobs_js(5, fd, pgrp);
  if (r == NO_KERNEL) r = !isatty(fd) ? -ENOTTY : (pgrp == getpid() ? 0 : -EPERM);
  if (r < 0) {
    errno = -r;
    return -1;
  }
  return 0;
}
