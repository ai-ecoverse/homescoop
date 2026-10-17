# @ai-ecoverse/wasix-sysroot

WASIX libc/libcxx/compiler-rt sysroots, laid out as a wasixcc `SYSROOT_PREFIX`:

- `sysroot` — no wasm exceptions (asyncify path)
- `sysroot-eh` / `sysroot-ehpic` — legacy EH, static / PIC
- `sysroot-exnref-eh` / `sysroot-exnref-ehpic` — exnref EH, static / PIC

Each tree has a real `lib/wasm32-wasip1` (not a symlink — npm/ipk skip
links). clang 24 `--target=wasm32-wasip1` resolves crt/libc there.
`unistd.h` declares `fork` under `__wasix__` even with `-fwasm-exceptions`.
EH `libc.a` archives get real `fork`/`_Fork` (static trees since -14, PIC trees since -23).
`stat`/`lstat`/`fstat`/`fstatat` report the file's owner from slicc-kernel
(since -24), else the caller's `getuid()`/`getgid()`.
`chmod`/`fchmod`/`fchmodat`/`umask` and the modes of fresh `open(O_CREAT)` /
`mkdir` go to the kernel's `slicc_fs` imports, and `stat`/`fstat`/`lstat`
read the permission bits back from them (slicc-kernel ≥
1.35.1); on a kernel without them they stay the upstream no-ops. EH trees ship
libc++/libc++abi/libunwind rebuilt from LLVM b158b0ae6 (same as wasm-clang)
with exnref flags.

Since 2025.9.30-18:

- `select`/`pselect` accept `exceptfds` (always returned empty) and wait for
  sub-second timeouts.
- `chdir` keeps the physical cwd, so `..` after a symlinked `cd` leaves the
  real directory. There is no `fchdir`: the kernel's `/proc/self/fd` does not
  name directory fds.
- POSIX `TZ` rules and TZif files work, not just UTC.
- `socketpair` honours `SOCK_NONBLOCK`/`SOCK_CLOEXEC` (slicc-kernel ≥ 1.41.0
  for `sock_pair`).
- `sigaction` honours `SA_RESETHAND` and reports each disposition to the
  kernel through `slicc.sigaction_set`. Kernels without that import answer
  ENOSYS, which is ignored.
- Since 2025.9.30-19:
  - `alarm` and `setitimer(ITIMER_REAL)` fire in every variant
    (`proc_raise_interval2`), and `getitimer` reports the time left.
  - `ITIMER_VIRTUAL`/`ITIMER_PROF` are EINVAL, since there are no CPU-time
    clocks.
  - A signal ends `nanosleep` early with EINTR and the time left, and ends
    `sleep` early with the seconds left.
  - `raise()` and `pthread_kill(pthread_self())` reach the handler.

Since 2025.9.30-34 (slicc-kernel ≥ 1.120.0 for all of it; older kernels keep -33's behaviour):

- **The sender in `siginfo_t`.** `sigwaitinfo`/`sigtimedwait` fill `si_code`, `si_pid` and `si_uid` (and `si_status` for SIGCHLD) through `slicc.sigwait_info` (slicc-kernel#911, 1.114.0, homescoop#770). A `kill()` is SI_USER with the sender's pid and uid, `pthread_kill` SI_TKILL, a child's exit CLD_EXITED with its status. Up to -33 it was always SI_USER with pid and uid 0.
- **`SA_SIGINFO` handlers run**, with a `siginfo_t` carrying the sender (`slicc.siginfo_take`). Up to -33 they never ran: the libc called them with the wrong wasm type.
- **`flock()`** is in libc, through `slicc.flock` (slicc-kernel#893, 1.117.0). It has Linux's semantics: locks per open file description on files, directories, pipes, sockets and terminals, and `LOCK_EX` works on a read-only descriptor. A handled signal ends a wait with EINTR, and `SA_RESTART` resumes it (1.117.3). On an older kernel it's a whole-file `fcntl` lock. Before, `<sys/file.h>` declared it but nothing defined it, so programs (perl, ruby) fell back to their own emulation.
- **`poll`:** a pipe write end without readers gives `POLLOUT|POLLERR`, as on Linux, not `POLLHUP` (homescoop#629).
- **`mkfifo`, `mkfifoat`, `mknod(S_IFIFO)`** make real FIFOs through `slicc_fs.path_mkfifo` (slicc-kernel#957, **1.120.0**, homescoop#878). On older kernels they are ENOSYS. Up to -33 libc had none of them.

Since 2025.9.30-33 the package is **built from source in CI** (homescoop#890). Up to -32 it was npm -14, a local build, with our libc changes patched in.
- **Inputs:** wasix-libc v2026-07-03.1, built per variant by its own `build32-general.sh` (libc, compiler-rt, and libc++/libc++abi/libunwind from llvm-project 6bb93a24), and wasix-org's LLVM 21.1.206. All are public and sha256-pinned.
- **libc:** our libc changes are layered on top as before. Every exported libc symbol and `libc.imports` is the same as -32's.
- **The C++ runtimes are upstream's:**
  - legacy wasm EH in `sysroot-eh`/`sysroot-ehpic`, exnref in the `exnref-*` trees, LLVM 20.1;
  - now with a real `__cxa_thread_atexit`, so `thread_local` objects with destructors link and run;
  - plus `__gxx_wasm_personality_v0`, the personality LLVM 24 code (wasm-clang) calls.
  - -32 had LLVM 24 exnref runtimes in all four EH trees. libc++ 20.1 defines fewer C++23/26 `__cpp_lib_*` feature macros than -32's libc++ 24.0: 165, not 195 (homescoop#935).

Since 2025.9.30-32 (slicc-kernel ≥ 1.108.0 for all three; older kernels keep -31's behaviour):

- **`epoll_pwait` is atomic.** With a mask, it waits through `slicc.sigmask_epoll_wait` (slicc-kernel#783, 1.106.2): the kernel swaps the mask in for the wait and restores it on every path, so a signal the mask unblocks always ends the wait with EINTR. On a kernel without it, the libc keeps -31's swap around `epoll_wait` (homescoop#466).
- **`sigwait`, `sigwaitinfo` and `sigtimedwait` work** through `slicc.sigwait` (slicc-kernel#786/#801, 1.106.2). They take a pending signal of the set, lowest first, without running its handler, or wait for one. `sigtimedwait` gives EAGAIN at the timeout and EINVAL for a bad `tv_nsec`. A handled signal outside the set runs its handler and the wait goes on, as musl's do. `siginfo_t` carries `si_signo` and `si_code = SI_USER`, with no sender pid. Up to -31, and on older kernels, they were ENOSYS (homescoop#520).
- **Inherited ignores.** A program started with signals set to SIG_IGN (`nohup`, bash's `trap '' PIPE`) sees SIG_IGN for them in `sigaction`, read from `slicc.sigaction_inherited` (slicc-kernel#841, 1.108.0, homescoop#740). Up to -31 the libc reported SIG_DFL. `sa_flags` reach the kernel unchanged, so `SA_NOCLDWAIT` and SIGCHLD SIG_IGN reap children there.

Since 2025.9.30-31:

- **AF_UNIX addresses.** `getsockname`, `getpeername`, `accept`, `recvfrom`
  and `recvmsg` return the socket's `sockaddr_un`: `AF_UNIX` and the path,
  length `offsetof(sun_path) + strlen + 1`, or an unnamed address of
  `sizeof(sa_family_t)`. Up to -30 the family came back 0 and the path empty.
  `bind`, `connect`, `sendto` and `sendmsg` take `sizeof(struct sockaddr_un)`
  as the length, as most C programs pass it. Up to -30 that failed with
  -1 and errno -1 ("Success"); a bad address now gives EINVAL or
  EAFNOSUPPORT.
- **Hangup on events-0 pollfds.** A `poll`/`ppoll` entry with no read/write
  interest is watched for hangup. A pipe or socket whose peer closed gives
  `POLLHUP`, and the write end of a pipe whose reader is gone gives `POLLERR`,
  as on Linux. Up to -30 such an entry never reported anything.
- **More named semaphores.** The libc no longer limits a process to 256 named
  semaphores. slicc-kernel's own limit goes up with slicc-kernel#770.
- **Known limit (lifted in -32):** `epoll_pwait`'s mask swap wasn't atomic.

Since 2025.9.30-30 named semaphores work between processes. `sem_open`,
`sem_close`, `sem_unlink`, `sem_wait`, `sem_trywait`, `sem_timedwait`,
`sem_post` and `sem_getvalue` on a named semaphore go to slicc-kernel
(`slicc.sem_*`, slicc-kernel ≥ 1.99.0). The kernel keeps the semaphore, a
forked child inherits its handles, an exec'd program opens it again by name,
and a second `sem_open` of the same name in a process returns the same
`sem_t *`. Unnamed semaphores (`sem_init`) are unchanged and work only
between threads. On an older kernel `sem_open` falls back to musl's
`/dev/shm` file, which fails there with ENOENT, as up to -29. Memory isn't
shared between processes, so `MAP_SHARED` mappings and `shm_open` can't
replace a semaphore.

Also since 2025.9.30-30, POSIX record locks: `<fcntl.h>` defines `F_GETLK`,
`F_SETLK`, `F_SETLKW` and `F_RDLCK`/`F_WRLCK`/`F_UNLCK`, `lockf` is in
libc, and `fcntl` hands the three lock commands to slicc-kernel
(`slicc.fcntl_lock`, slicc-kernel#722), which keeps them per process, as
Linux does: not inherited by `fork`, kept across `exec`, dropped when any
descriptor of the file closes. On a kernel without the import every lock is
granted locally and `F_GETLK` reports `F_UNLCK`, as programs' own stubs did.
Up to -29 WASIX defined none of these. `flock` is in libc since -34 (above).

Since 2025.9.30-29 `poll` and `ppoll` take a `pollfd` that asks for neither
reading nor writing (`events` 0, as OpenSSH's client loop passes for idle
channels, or only bits WASI can't poll): the entry is skipped, and its
`revents` stays 0 unless the descriptor is bad, which gives `POLLNVAL` at
once. Up to -28 the whole call failed with ENOSYS. Such an entry gets no
`POLLHUP`/`POLLERR` (WASI polls only for reading and writing); `POLLPRI` is
`POLLIN` in these headers. A call with only such entries waits out its
timeout, or until a signal handler runs. `epoll_ctl` maps Linux's
`EPOLL_CTL_ADD`/`MOD`/`DEL` (1/3/2, what `<sys/epoll.h>` defines) to WASIX's
0/1/2 and fails with -1 and `errno`; up to -28 it passed the Linux number on
(an ADD arrived as a WASIX MOD, a MOD as an invalid op) and returned the
errno as its value, so every error looked like success (homescoop#443).
`epoll_wait` gives back the whole 64-bit `data` (up to -28 any value whose
low 32 bits are 0 came back as the fd) and as many events as `maxevents`
asks for (it was capped at 64), `epoll_create1` honours `EPOLL_CLOEXEC`, and
`epoll_pwait` installs its signal mask for the wait. WASIX epoll needs
slicc-kernel ≥ 1.95.0; older kernels answer ENOSYS. On slicc-kernel 1.95.x
`EPOLL_CTL_MOD` of an fd that isn't registered adds it instead of failing
with ENOENT: the kernel still takes -28's numbering (slicc-kernel#684).

Since 2025.9.30-28 signal masks work. `sigprocmask` and `pthread_sigmask`
hand the thread's mask to slicc-kernel (`slicc.sigmask_set`), which holds a
blocked signal as pending and delivers it when it is unblocked, before the
call returns; `sigpending` reports the pending set (`slicc.sigpending_get`).
`SIGKILL` and `SIGSTOP` cannot be blocked. Up to -27 `pthread_sigmask` did
nothing (it did not even fill in the old mask), so a blocked signal was
delivered at once, and `sigpending` failed. On a slicc-kernel without these
imports the libc keeps the mask itself: masks read back right, but a blocked
signal is still delivered at once and nothing is ever pending.
`pselect` with a signal mask, `ppoll` (new) and `sigsuspend` install the
mask for the wait in one kernel call (`slicc.sigmask_poll`), so a signal
blocked everywhere else reaches its handler there, as gnupg's daemons and
openssh expect. `sigwait`, `sigtimedwait` and `sigwaitinfo` fail with ENOSYS
(up to -27 they reported success with a garbage signal number).
On slicc-kernel before 1.91.0 (slicc-kernel#561, every wasix-sysroot
version): a signal that reaches a thread while it runs its own code, not
inside a kernel call, is handled at the start of the thread's next kernel
call, and if that call is a wait it still sleeps its whole timeout. Up to -27
this hit every signal sent during computation; -28 on 1.88.0 leaves it only
between the mask swap and the wait inside `pselect`/`ppoll`, and
`slicc.sigmask_poll` (1.89.0) narrows it further. slicc-kernel 1.91.0 fixes
it: such a wait returns EINTR at once.

Since 2025.9.30-27 setting file times works for every form (homescoop#294).
Up to -26, `utimensat(…, NULL)`, `futimens(fd, NULL)`, `utimes(p, NULL)` and
`utime(p, NULL)`, which mean "now", set the times to 0 (1970) in static
builds, and returned -1 without errno in PIC ones. `UTIME_NOW`/`UTIME_OMIT` in
the second timespec returned -1 without errno too. Python's `os.utime(p)` and
`pathlib.Path.touch()`, Perl's `utime undef, undef` and Ruby's
`FileUtils.touch` are affected. `clock()`, `times()` and `getrusage()` now
report the process CPU time slicc-kernel keeps (`CLOCK_PROCESS_CPUTIME_ID`):
`clock()` in `CLOCKS_PER_SEC` units, `times()` in clock ticks (100 a second)
with the elapsed real time as its value, and `tms_stime`, `tms_cutime`,
`tms_cstime`, `ru_stime` and `RUSAGE_CHILDREN` 0, since the kernel has no
system or children's times yet. Up to -26 they mixed in the wall clock.

Since 2025.9.30-26 an empty path is ENOENT, as POSIX and Linux have it:
`open("")`, `stat("")`, `access("")`, `mkdir("")`, `chmod("")`, `symlink("", x)`
and every other call that takes a path used to act on the current directory
(libc made `""` relative to the cwd). With slicc-kernel ≥ 1.71.1 the
`*at(dirfd, "")` forms are ENOENT too (slicc-kernel#404).
`fstatat(fd, "", st, AT_EMPTY_PATH)` (0x1000) is `fstat(fd)`.

Since 2025.9.30-25 `access`, `faccessat`, `eaccess` and `euidaccess` ask
slicc-kernel (`slicc_fs.path_access`, slicc-kernel >= 1.63.0, K3(b)), which
checks the file's owner, group and mode against the real ids (`access`) or the
effective ids (`AT_EACCESS`, `eaccess`), as Linux does, including search
permission on every directory of the path and root needing an x bit for
`X_OK`. With users `'off'` or `'report'` it checks that the path exists, and
`X_OK` on a device is EACCES whenever owners are on (`'report'` too).
On an older kernel the -24 check stays (the path exists; WASI rights).
- `AT_EACCESS` is now 0x200 (it was 0, so `faccessat(…, AT_EACCESS)` was
  `access`); `faccessat` also takes `AT_SYMLINK_NOFOLLOW`, which was EINVAL.
- `eaccess`/`euidaccess` exist (declared with `_GNU_SOURCE`, as in glibc).
- `linkat` refuses flags other than `AT_SYMLINK_FOLLOW` (WASIX's 0x2) with
  EINVAL, as Linux does.
- `open` already asks only for the rights its mode needs (`O_RDONLY`: no
  write rights), so under users `'enforce'` a read-only file opens for reading;
  slicc-kernel counts a request for write rights as a write.

Since 2025.9.30-24 files have real owners when slicc-kernel keeps them
(`createKernel({ users: 'report' | 'enforce' })`, slicc-kernel K3):
- `chown`/`lchown`/`fchown`/`fchownat` go to the kernel (`slicc_fs.path_chown`/
  `fd_chown`), which applies Linux's rules: root may set anything, an owner may
  only change the group to one of its own, -1 keeps an id, EPERM otherwise;
- `stat`/`lstat`/`fstat` report the stored owner instead of the caller's own
  ids: one call, `slicc_fs.path_filestat_owner`/`fd_filestat_owner` (the WASI
  filestat and the owner together), or on a kernel without those the WASI
  filestat plus `slicc_fs.path_owner`/`fd_owner`;
- with users `'off'` the chown calls still check the path or fd (ENOENT,
  EBADF) but change nothing, and `stat` shows the caller's ids, as before;
- on a kernel without these imports everything stays as in -23: chown to
  anything but 0/-1 is ENOSYS, and `stat` shows `getuid()`/`getgid()`.

`linkat(AT_FDCWD, old, AT_FDCWD, new, …)` (and with two absolute paths) links
`old` again; up to -23 it passed `new` as both paths and failed with ENOENT.

Since 2025.9.30-23 `ioctl` also takes Linux's request numbers for the
window size, `TIOCGWINSZ` 0x5413 and `TIOCSWINSZ` 0x5414, next to WASIX's
0x101/0x102 (the headers keep those): code and ctypes snippets that hard-code
the Linux numbers got EINVAL before (homescoop#250).
`sysroot-ehpic` and `sysroot-exnref-ehpic` now have `fork`/`_Fork` like the
static trees (homescoop#253). As there, a program must be asyncified
(`wasm-opt --asyncify --pass-arg=asyncify-imports@wasix_32v1.proc_fork`) for
`fork()` to work, or it returns ENOSYS. A child forked after a `dlopen` cannot
call into the side module yet (slicc-kernel#337).

Since 2025.9.30-22 every program linked against the sysroot carries a wasm
custom section `slicc.libc` = `wasix-sysroot <version>` (from `crt1*.o`), so
slicc-kernel can tell libc generations apart (`wasm-opt` and `llvm-strip` keep
it). Side modules carry none. `getitimer` moved into `setitimer.c`, so a
dynamic-main no longer exports the `__homescoop_itimer_real_left` helper.

Since 2025.9.30-21 terminals are per descriptor (slicc-kernel's `slicc_tty`,
slicc-kernel#289):
- `tcgetattr`/`tcsetattr` carry the whole termios, so `cfmakeraw` is really
  raw;
- `ioctl(TIOCGWINSZ)`, `TCGETS`/`TCSETS*` and `isatty` answer for that fd
  (ENOTTY on pipes and files);
- `ioctl(TIOCSWINSZ)` returns 0 on a terminal but changes nothing: the size
  is the page's, and slicc-kernel has no set-window-size call (ENOTTY
  elsewhere);
- `fstat`/`stat`/`lstat` take a file's type from slicc-kernel's `slicc_fs`
  mode when it carries one, so a pipe is `S_ISFIFO` once the kernel reports
  it (WASI has no FIFO filetype); otherwise the WASI filetype stays;
- older kernels keep the previous behaviour.

Since 2025.9.30-20 user and group ids come from slicc-kernel's process
credentials (`slicc.cred_get`/`cred_set`/`groups_get`/`groups_set`; slicc-kernel
≥ 1.44.0, which has users), and `getpw*`/`getgr*` read its `/etc/passwd` and `/etc/group`.
There is no fallback to uid 1000: on an older kernel `getuid()` returns -1,
the set\*id calls fail with ENOSYS, and user lookups find nothing.

Data only — no commands. Set `WASIXCC_SYSROOT_PREFIX` to this package directory.

## File type bits (`S_IF*`) differ from Linux

WASIX libc compiles `st_mode` file types from `__mode_t.h`. The values are
part of the ABI of every package built on this sysroot, so they stay:

| | WASIX | Linux |
| --- | --- | --- |
| `S_IFREG`, `S_IFDIR`, `S_IFLNK`, `S_IFCHR`, `S_IFBLK` | same as Linux | 0o100000, 0o040000, 0o120000, 0o020000, 0o060000 |
| `S_IFIFO` | **0o140000** (Linux's `S_IFSOCK`) | 0o010000 |
| `S_IFSOCK` | **0o160000** | 0o140000 |
| `S_IFMT` | **0o160000** (the OR of the types; Linux's FIFO bit 0o010000 is masked away) | 0o170000 |

slicc-kernel's pipes are WASI sockets (filetype `SOCKET_STREAM`, since
slicc-kernel#280). So `fstat` on any pipe gives `0o160000 | perms`, and inside
a WASIX program `S_ISSOCK` is true and `S_ISFIFO` false, consistently.

Inside one program the macros agree with each other. The hazard is a raw
`st_mode` that crosses the wasm boundary: it carries WASIX numbers. Examples:
- cpio `newc` headers;
- tar entries for sockets and FIFOs;
- JSON stat dumps read by Node or bash;
- scripts comparing octal modes with Linux constants (a cert once saw
  `S_ISSOCK False` this way).

Decode such values with the table above, or translate them before they leave
the program.
