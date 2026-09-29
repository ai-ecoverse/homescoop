/*
 * posix_spawn / waitpid for Emscripten tools running in slicc.
 *
 * In the wasm realm (#3530) the runtime publishes Module.sliccKernel: a child
 * is a kernel process (concurrent when its stdio are the tool's kernel fds),
 * and waitpid blocks in the kernel. Everywhere else (the node realm):
 *
 * The realm has no fork, but child_process.spawnSync runs a command to
 * completion through slicc's shell. A spawn therefore runs the child right
 * away, hands its output to the caller's fds, and records its exit status
 * under a fake pid; waitpid / wait4 hand those statuses back. posix_spawn
 * file actions and attributes are ignored (children write to the tool's own
 * stdout/stderr). slicc_spawn_capture is the general form, for callers that
 * wire their own stdio (libuv's uv_spawn in cmake).
 *
 * In the wasm realm a child also inherits the tool's fds beyond 2 that are not
 * close-on-exec, at the same numbers; posix_spawn's file actions on those fds
 * (close, dup2, open) go along as `[target, source]` pairs (source -1 closes).
 */
#include <emscripten.h>
#include <fcntl.h>
#include <spawn.h>
#include <unistd.h>
#include <stddef.h>
#include <sys/resource.h>
#include <sys/types.h>
#include <sys/wait.h>

// Returns the child's pid, or -errno (wasi numbering: ENOENT 44, EIO 29).
// `actions`: `nactions` [target, source] pairs for the child's fds beyond 2.
EM_JS(int, slicc_spawn_capture_js,
      (const char *path, char *const *argv, char *const *envp, const char *cwd, int in_fd,
       int out_fd, int err_fd, const int *actions, int nactions),
      {
        const strings = (ptr) => {
          const out = [];
          for (let i = 0; ptr; i++) {
            const s = HEAPU32[(ptr >> 2) + i];
            if (!s) break;
            out.push(UTF8ToString(s));
          }
          return out;
        };
        const isTty = (st) => st && FS.isChrdev(st.node.mode);
        const file = UTF8ToString(path);
        // No program to run is ENOENT, never a successful empty command.
        if (!file) return -44;
        const args = strings(argv);
        const envList = strings(envp);
        const env = {};
        for (const kv of envList) {
          const eq = kv.indexOf('=');
          if (eq > 0) env[kv.slice(0, eq)] = kv.slice(eq + 1);
        }
        if (Module.sliccKernel) {
          const pairs = [];
          for (let i = 0; i < nactions; i++) {
            pairs.push([HEAP32[(actions >> 2) + 2 * i], HEAP32[(actions >> 2) + 2 * i + 1]]);
          }
          // An inherited stdin (-2) is the tool's own fd 0.
          return Module.sliccKernel.spawn(file, args, envList.length ? env : null,
                                          cwd ? UTF8ToString(cwd) : null,
                                          [in_fd === -2 ? 0 : in_fd, out_fd, err_fd], pairs);
        }
        // stdin: whatever is readable on in_fd now (a file, or a pipe the
        // caller already filled); a terminal is left alone.
        let input;
        if (in_fd >= 0) {
          try {
            const st = FS.getStream(in_fd);
            if (st && !isTty(st)) {
              const chunks = [];
              const buf = new Uint8Array(65536);
              let n;
              while ((n = FS.read(st, buf, 0, buf.length)) > 0) chunks.push(buf.slice(0, n));
              if (chunks.length) input = Buffer.concat(chunks);
            }
          } catch (e) {
            // an empty non-blocking pipe (EAGAIN): no input
          }
        }
        // The child reads and writes the VFS behind this tool's FS: push the
        // tool's buffered writes first, drop its cached view after.
        if (Module.sliccBeforeSpawn) Module.sliccBeforeSpawn();
        let r;
        try {
          r = require('child_process').spawnSync(file, args.slice(1), {
            cwd: cwd ? UTF8ToString(cwd) : FS.cwd(),
            env: envList.length ? env : process.env,
            input,
          });
        } catch (e) {
          return e && e.code === 'ENOENT' ? -44 : -29;
        } finally {
          if (Module.sliccAfterSpawn) Module.sliccAfterSpawn();
        }
        if (r.error) return r.error.code === 'ENOENT' ? -44 : -29;
        const put = (fd, data) => {
          if (fd < 0 || !data || !data.length) return;
          const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
          let st;
          try {
            st = FS.getStream(fd);
          } catch (e) {}
          // The tool's own terminal: straight to the realm's streams, byte-exact.
          if ((fd === 1 || fd === 2) && (!st || isTty(st))) {
            (fd === 1 ? process.stdout : process.stderr).write(bytes);
            return;
          }
          if (st) FS.write(st, bytes, 0, bytes.length);
        };
        put(out_fd, r.stdout);
        put(err_fd, r.stderr);
        Module.sliccExited = Module.sliccExited || new Map();
        Module.sliccNextPid = Module.sliccNextPid || 1000;
        const pid = ++Module.sliccNextPid;
        // Encode like a real wait status: exit code << 8, or the signal number.
        Module.sliccExited.set(pid, r.signal ? 9 : ((r.status ?? 1) & 0xff) << 8);
        return pid;
      });

// Returns the reaped pid (0 for WNOHANG with none exited), or -errno (ECHILD 12).
// `options`: waitpid's bits (WNOHANG 1; WUNTRACED 2 and WCONTINUED 8 report
// stops and continues, after which the child is still there to wait for).
EM_JS(int, slicc_wait_js, (int pid, int *status, int options), {
  const nohang = options & 1;
  const gone = (st) => (st & 0xff) !== 0x7f && st !== 0xffff;
  const done = Module.sliccExited;
  const kernel = Module.sliccKernel;
  if (kernel) {
    const put = (reaped, st) => {
      if (status && reaped > 0) HEAP32[status >> 2] = st;
      return reaped;
    };
    // A forked child that already exited (slicc-fork.js).
    const exitedKey = pid > 0 ? (done?.has(pid) ? pid : undefined) : done?.keys().next().value;
    if (exitedKey !== undefined) {
      const st = done.get(exitedKey);
      done.delete(exitedKey);
      return put(exitedKey, st);
    }
    // A forked child that exec'd stands for its kernel process.
    const aliases = Module.sliccAliases;
    if (pid > 0 && aliases?.has(pid)) {
      const r = kernel.wait(aliases.get(pid), !!nohang, options);
      if (typeof r === 'number') return r;
      if (r[0] > 0 && gone(r[1])) aliases.delete(pid);
      return put(r[0] > 0 ? pid : 0, r[1]);
    }
    const r = kernel.wait(pid, !!nohang, options);
    if (typeof r === 'number') return r;
    for (const [forkPid, kernelPid] of aliases ?? []) {
      if (kernelPid !== r[0]) continue;
      if (gone(r[1])) aliases.delete(forkPid);
      return put(forkPid, r[1]);
    }
    return put(r[0], r[1]);
  }
  if (!done || done.size === 0) return -12;
  const key = pid > 0 ? pid : done.keys().next().value;
  if (!done.has(key)) return -12;
  if (status) HEAP32[status >> 2] = done.get(key);
  done.delete(key);
  return key;
});

int slicc_spawn_capture(const char *file, char *const *argv, char *const *envp, const char *cwd,
                        int in_fd, int out_fd, int err_fd) {
  return slicc_spawn_capture_js(file, argv, envp, cwd, in_fd, out_fd, err_fd, NULL, 0);
}

// In the wasm realm, a forked child (slicc-fork.js) that execs `pid` becomes
// it: returns 1 when the caller should end without waiting.
EM_JS(int, slicc_exec_detach, (int pid), {
  if (!Module.sliccKernel || typeof SliccFork === 'undefined' || !SliccFork.stack.length) return 0;
  SliccFork.execPid = pid;
  return 1;
});

// musl's private file-action record (src/process/fdop.h): a list, newest
// first, that the child applies oldest first.
struct slicc_fdop {
  struct slicc_fdop *next, *prev;
  int cmd, fd, srcfd, oflag;
  mode_t mode;
  char path[];
};
enum { SLICC_FDOP_CLOSE = 1, SLICC_FDOP_DUP2 = 2, SLICC_FDOP_OPEN = 3, SLICC_FDOP_CHDIR = 4 };

int posix_spawn(pid_t *restrict pid, const char *restrict path,
                const posix_spawn_file_actions_t *fa, const posix_spawnattr_t *restrict attr,
                char *const argv[restrict], char *const envp[restrict]) {
  // Which of this tool's fds the child's 0/1/2 end up on (-1: closed). An
  // inherited stdin is -2: the wasm-realm kernel shares the tool's fd 0, the
  // node realm gives the child none (fd 0 is the terminal there).
  int stdio[3] = {-2, 1, 2};
  int opened[8];
  int nopened = 0;
  // File actions on the child's fds beyond 2: [target, source] (source -1 closes).
  int actions[64];
  int nactions = 0;
  const char *cwd = NULL;
  struct slicc_fdop *op = fa ? (struct slicc_fdop *)fa->__actions : NULL;
  while (op && op->next) op = op->next;
  for (; op; op = op->prev) {
    int target = op->fd;
    // What the child's `target` becomes: one of this tool's fds, -1 (closed),
    // or -2 (the inherited stdin, which only stdio slots carry).
    int src;
    if (op->cmd == SLICC_FDOP_DUP2) {
      src = op->srcfd <= 2 ? stdio[op->srcfd] : op->srcfd;
    } else if (op->cmd == SLICC_FDOP_CLOSE) {
      src = -1;
    } else if (op->cmd == SLICC_FDOP_OPEN) {
      src = open(op->path, op->oflag, op->mode);
      if (src < 0) goto fail;
      if (nopened < 8) opened[nopened++] = src;
    } else {
      if (op->cmd == SLICC_FDOP_CHDIR) cwd = op->path;
      continue;
    }
    if (target <= 2) {
      stdio[target] = src;
    } else if (nactions < 32) {
      actions[2 * nactions] = target;
      actions[2 * nactions + 1] = src == -2 ? 0 : src;
      nactions++;
    }
  }
  int r = slicc_spawn_capture_js(path, argv, envp, cwd, stdio[0], stdio[1], stdio[2], actions,
                                 nactions);
  for (int i = 0; i < nopened; i++) close(opened[i]);
  if (r < 0) return -r;
  if (pid) *pid = r;
  return 0;
fail:
  for (int i = 0; i < nopened; i++) close(opened[i]);
  return 2; // ENOENT: an open() file action failed
}

// The shell resolves PATH, so spawnp is the same call.
int posix_spawnp(pid_t *restrict pid, const char *restrict file,
                 const posix_spawn_file_actions_t *fa, const posix_spawnattr_t *restrict attr,
                 char *const argv[restrict], char *const envp[restrict]) {
  return posix_spawn(pid, file, fa, attr, argv, envp);
}

pid_t __syscall_wait4(pid_t pid, int *wstatus, int options, struct rusage *rusage) {
  return slicc_wait_js(pid, wstatus, options);
}
