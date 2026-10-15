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
