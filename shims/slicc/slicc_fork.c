/*
 * fork for Emscripten programs running in a slicc node realm (bash first).
 * Link with slicc_exec.c, slicc_spawn.c, --js-library slicc-fork.js and
 * -sASYNCIFY.
 *
 * A child runs to completion before its parent continues. fork() unwinds the
 * wasm call stack (Asyncify), and slicc-fork.js snapshots the process: linear
 * memory, the stack pointer, the fd table and the cwd. The child resumes from
 * fork() returning 0; its exit restores the snapshot, and the parent resumes
 * with the child's pid. Pipes and files live outside linear memory, so what
 * the child wrote is there for the parent (and the next pipeline stage) to
 * read. A pipeline therefore runs one stage after the other, and a background
 * job runs to completion before `&` returns.
 *
 * execve() is slicc_exec.c: a forked child that execs runs the program and
 * exits with its status, as if replaced by it.
 */
#include <sys/types.h>
#include <unistd.h>

int slicc_fork_js(void);
int slicc_getpid_js(void);
int slicc_getppid_js(void);

pid_t fork(void) { return slicc_fork_js(); }

pid_t vfork(void) { return fork(); }

pid_t __syscall_getpid(void) { return slicc_getpid_js(); }

pid_t __syscall_getppid(void) { return slicc_getppid_js(); }
