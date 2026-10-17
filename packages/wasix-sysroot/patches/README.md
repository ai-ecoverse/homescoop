# wasix-sysroot local patches

## `fcntl.c` — F_SETFD CLOEXEC precedence (wasix-libc main)

Upstream:
`libc-bottom-half/cloudlibc/src/libc/fcntl/fcntl.c` (wasix-org/wasix-libc `main`)

```c
__wasi_fdflagsext_t fd_flags = flags | FD_CLOEXEC ? __WASI_FDFLAGSEXT_CLOEXEC : 0;
```

`|` binds tighter than `?:`, so the condition is always true. Every
`fcntl(fd, F_SETFD, x)` — including `x = 0` to clear close-on-exec — sets
`__WASI_FDFLAGSEXT_CLOEXEC`. Perl clears CLOEXEC on fds `<= $^F` (0..2);
stdio then closes across `exec`, and `autoconf`'s `exec autom4te` loses
stdin/out/err.

Fixed:

```c
__wasi_fdflagsext_t fd_flags =
    (flags & FD_CLOEXEC) ? __WASI_FDFLAGSEXT_CLOEXEC : 0;
```

`build.sh` compiles this object (static + PIC) and replaces `fcntl.o` in
every shipped `libc.a`. No upstream report (project rule).

## `../slicc_stat_owner.c` — st_uid/st_gid = getuid()/getgid()

WASI filestat has no owner. Replaces `fstat.o` + `fstatat.o` so public
`stat`/`lstat`/`fstat`/`fstatat` (all via `__wasilibc_nocwd_fstatat` or
`fstat`) report the slicc identity uid/gid (1000). `chown`/`fchown` stay
upstream no-ops.

## `posix.c`, `at_fdcwd.c` — file modes via `slicc_fs` (homescoop#169)

Upstream: `libc-bottom-half/sources/{posix.c,at_fdcwd.c}` at wasix-libc
tag `v2025-09-02.1` (sha256 `2415a912…` / `c0362278…`). WASI has no call
that sets a mode, so upstream `chmod`/`fchmod`/`fchmodat` return 0,
`umask` echoes its argument, and `open`/`mkdir` drop the mode.

These copies call the kernel's `slicc_fs` imports (slicc-kernel#197, #208):
`fd_chmod(fd, mode)`, `path_chmod(dirfd, path, len, mode, flags)`
(flag 1 = no-follow) and `umask(mask, *old)`.

- `chmod`, `fchmod`, `fchmodat` call the imports.
- `umask` is read from the kernel once per process (slicc_fs.umask always
  sets, so the first read sets 0 and restores) and cached; `umask()` updates
  kernel and cache. Without slicc_fs it is a process-local value (022).
- `open`/`openat` with `O_CREAT`: the kernel creates files `0666 & ~umask`
  itself (slicc-kernel#208), so a mode that comes out the same costs nothing
  extra. Another mode is set with one `fd_chmod` on a fresh create only;
  freshness comes from `O_EXCL` (try the exclusive create, on `EEXIST` open
  the existing file), never from a stat first. `mkdir`/`mkdirat` call
  `path_chmod` only when the mode differs from `0777 & ~umask`.
- `ENOSYS` (an older kernel) is success: behaviour stays as upstream.

The read side is in `../slicc_stat_owner.c`: `fstat` and
`__wasilibc_nocwd_fstatat` (so `stat`/`lstat`/`fstatat`) OR the bits from
`slicc_fs.fd_mode(fd, *mode)` / `path_mode(dirfd, path, len, flags, *mode)`
into `st_mode`. Without them `st_mode` has only the file type, as upstream.

Cert: `test/run-modes.mjs --tarball <package.tgz>` (cert/meta.json, harness
host-node) builds `test/modes.c` against the tarball and runs `test/modes.mjs`
on the kernel's Node entry. `test/run-bench.mjs --tarball <package.tgz>`
times creates (`test/bench-create.c`) against the published -15, interleaved,
medians.

`build-incremental.sh` compiles both files (static + PIC, the shipped
objects' target features) and replaces `posix.o` and `at_fdcwd.o` in every
`libc.a`. It first checks that each patched object defines every symbol
the shipped one did.

## -18: `pselect.c`, `chdir.c`, `__tz.c`, `socketpair.c`, `sigaction.c`

All from wasix-libc tag `v2025-09-02.1`. `build-incremental.sh` replaces `pselect.o`, `chdir.o`, `__tz.o`, `socketpair.o` and `sigaction.o` in every `libc.a`, after checking that each patched object defines every symbol the shipped one did.

- **`pselect.c`** (`select` calls it), homescoop#195:
  - A non-empty `errorfds` is accepted and comes back empty. WASI poll has no exceptional conditions, and `POLLPRI == POLLIN` here. Upstream failed with ENOSYS, which broke `select(r, w, x)` in perl, python, ruby and C.
  - With only `errorfds` and no timeout it waits, as POSIX does.
  - The relative timeout is computed directly. Upstream reused `common/time.h`'s absolute-time clamp, which turns `tv_sec <= 0` into 1 ns, so every sub-second `select`/`pselect` returned at once.
- **`chdir.c`**, homescoop#196: `chdir()` resolves the path with `realpath()` and passes the physical absolute path to both the libc cwd cache and `__wasi_chdir`. `..` and relative paths after a symlinked `cd` then start from the real directory. There is still no `fchdir`: the kernel's `/proc/self/fd` does not name directory fds.
- **`__tz.c`**, homescoop#193: musl's TZ code, which wasix-libc compiled out in favour of a UTC-only `__secs_to_zone`, is enabled again.
  - POSIX rule strings work, for example `EST5EDT,M3.2.0,M11.1.0`.
  - TZif files (`TZ=:/path`, `/usr/share/zoneinfo/<name>`, `/etc/localtime`) are read into memory instead of mmap'd, since mmap would need `-lwasi-emulated-mman`.
  - Zone names only resolve once a zoneinfo tree exists.
  - `__secs_to_zone` keeps wasix-libc's `int *offset`.
- **`socketpair.c`:** upstream wasix-libc 2025b44a5d, backported. `SOCK_NONBLOCK`/`SOCK_CLOEXEC` in the type are applied to both ends instead of reaching `sock_pair` as part of the type. Its fcntl half is `fcntl.c` above.
- **`sigaction.c`** (musl `src/signal/sigaction.c`), agreed with slicc-kernel:
  - Every `sigaction()` that sets a disposition also calls the import `slicc.sigaction_set(sig, disposition, sa_flags)`. The disposition is 0 for `SIG_DFL`, 1 for `SIG_IGN` and 2 for a handler; `sa_flags` are passed raw. The kernel can then apply `SIG_DFL` itself and deliver only handled signals to `__wasm_signal`. A kernel without the import answers ENOSYS, which is ignored, so behaviour there is unchanged.
  - `__wasm_signal` honours `SA_RESETHAND`: the disposition goes back to `SIG_DFL` (reported to the kernel as 0) before the handler runs. Upstream ignored the flag.
  - `__wasm_signal` never calls through `SIG_IGN`.
  - `raise()` uses `thread_signal`, which slicc-kernel does not deliver yet, so the probe signals itself with `kill(getpid(), …)`.

## -19: `setitimer.c`, `getitimer.c`, `clock_nanosleep.c`, `sleep.c`, `raise.c`, `pthread_kill.c`

All from wasix-libc tag `v2025-09-02.1`. `build-incremental.sh` replaces these members in every `libc.a`, after the symbol check.

Before -19 the variants differed: `sysroot-ehpic` and `sysroot-exnref-ehpic` had wasix-python's setitimer and EINTR libc patches, and `sysroot`, `sysroot-eh` and `sysroot-exnref-eh` had upstream's. -19 also drops the `libc.a.bak-*` archives those patches left in `sysroot-ehpic`.

- **`setitimer.c`** (`alarm` calls it):
  - `ITIMER_REAL` calls `wasix_32v1.proc_raise_interval2(SIGALRM, it_value ns, it_interval ns, repeat)`, so `alarm(N)` and one-shot timers fire.
  - Upstream passed only `it_interval` to the 3-arg `proc_raise_interval`, so `alarm(N)`, whose interval is 0, cancelled the timer.
  - `ITIMER_VIRTUAL` and `ITIMER_PROF` fail with EINVAL. WASIX has no CPU-time clocks, and a wall-clock SIGVTALRM/SIGPROF (or the SIGALRM upstream armed) would kill a program that asked for a profiling timer.
  - Out-of-range `tv_usec` is EINVAL.
  - The armed REAL timer is kept on the monotonic clock, so `old` reports the time left. That is what `alarm()` returns.
  - The import has a private C name, because `sysroot-ehpic`'s `__wasixlibc_real.o` already defines `__wasi_proc_raise_interval2`.
- **`getitimer()`** (in `getitimer.c` until -21, in `setitimer.c` since -22): `ITIMER_REAL` reports the time left until the next expiry, plus the interval. The others are -1 EINVAL. Upstream returned EINVAL as a value and left the struct alone.
- **`clock_nanosleep.c`** (`nanosleep`, `usleep`): a relative sleep that a signal cuts short returns EINTR and the time left (`rem`), as on Linux.
  - Upstream answered ENOTSUP for every failure.
  - slicc-kernel ends the clock wait early but reports the clock as expired, so a relative sleep that ends more than 1 ms early counts as interrupted.
  - An explicit EINTR from the kernel is honoured too. That is what the PIC variants see, since their modules import `fd_fdflags_set`.
  - `rqtp` and `rmtp` may be the same struct (`sleep()`, `nanosleep(&ts, &ts)` retry loops): the request is copied first and `*rmtp` written last.
- **`sleep.c`:** an interrupted `sleep()` returns the whole seconds left (`rem.tv_sec`), as musl does. Upstream returned all of them.
- **`raise.c`:** `raise()` signals the process through `proc_signal(getpid())`, as `kill()` does, and sets errno on failure.
  - Upstream used `thread_signal`, which slicc-kernel does not deliver for the main thread, so the handler never ran. slicc-kernel#250 will add per-thread delivery.
  - Upstream also returned the WASI errno as `raise()`'s result.
- **`pthread_kill.c`:** a target with the main thread's placeholder tid (`0x3fffffff`, which the kernel does not know: ESRCH) is signalled through `proc_signal(getpid())`. Other threads keep `thread_signal`. A bad signal number is EINVAL.
## -20: `../slicc_identity.c` — credentials from slicc-kernel (homescoop#207)

Needs slicc-kernel ≥ 1.44.0 (K1, slicc-kernel#251).

- **Ids come from the kernel.** `getuid`/`geteuid`/`getgid`/`getegid`, `getresuid`/`getresgid` and `getgroups` ask it through the `slicc` module's `cred_get` and `groups_get`. The set calls (`setuid`, `seteuid`, `setreuid`, `setresuid`, the gid versions and `setgroups`) go through `cred_set` and `groups_set`. Linux's rules apply:
  - `setuid`/`setgid` set all three ids for a privileged caller and only the effective id otherwise;
  - `setreuid`/`setregid` update the saved id as Linux does;
  - the kernel enforces the POSIX permissions (EPERM, EINVAL).
- **Members replaced.** `build-incremental.sh` removes cloudlibc's no-op `setuid.o`, `seteuid.o`, `setgid.o`, `setegid.o` and the ENOTSUP `setgroups.o`. The fixed uid 1000 `slicc_identity.o` is replaced.
- **Names come from the files.** The static `user`/1000 passwd entry is gone. musl's own `getpwent.o`, `getpw_r.o`, `getgrent.o` and `getgr_r.o`, compiled from the libc tag, read the kernel's real `/etc/passwd` and `/etc/group`.
- **Headers.** `unistd.h` declares `getgroups`, `setreuid`/`setregid` and `setresuid`/`setresgid`/`getresuid`/`getresgid`, which wasi-libc had hidden.
- **No fallback.** On a kernel without K1 the imports answer ENOSYS:
  - the getters return `(uid_t)-1`;
  - `getgroups` and every setter return -1 with errno ENOSYS;
  - `getpw*`/`getgr*` find nothing unless `/etc/passwd` exists.

### -20: `__tz.c` — `%Z` for a copied `tm_zone`

musl's `__tm_to_tzname` (used by `strftime("%Z")`) prints `tm_zone` only if it is one of musl's own pointers: `__tzname[0/1]`, `__utc`, or the loaded TZif abbreviations. Any other pointer prints `""`, which guards against garbage pointers in a caller's `struct tm`.

CPython's `time.strftime` builds `struct tm` from a tuple, so its `tm_zone` points at a Python-owned copy and `%Z` was always empty. -20 maps a pointer whose text equals a name this tz knows (`__tzname[0/1]`, `UTC`, a TZif abbreviation) to musl's string. Anything else, NULL included, still prints `""` (`test/tzname.c`).

## -21: `tcgetattr.c`, `tcsetattr.c`, `tcflush.c`, `tcdrain.c`, `ioctl.c`, `isatty.c` — terminals per descriptor (`slicc_tty.h`)

slicc-kernel's `slicc_tty` module (slicc-kernel#289) answers per file descriptor. All three calls return 0 or a WASI errno:
- `tcgetattr(fd, out)` and `tcsetattr(fd, actions, in)` carry musl's 60-byte wasm32 `struct termios`.
- `winsize(fd, out)` fills in the window size.
- A fd that is no terminal gets ENOTTY, and a closed fd EBADF.

The six members change as follows:

- **`tcgetattr`/`tcsetattr`:** the whole termios goes to the kernel, so `cfmakeraw` + `tcsetattr` is really raw: ISIG, IEXTEN, OPOST, `c_iflag` and `c_cc` included (homescoop #247). Before, `tty_set` carried only echo and canonical mode, so ^C still raised SIGINT.
- **`ioctl`:** `TCGETS`/`TCSETS`/`TCSETSW`/`TCSETSF` go through the above (Linux's request numbers, defined in `slicc_tty.h`, since wasi-libc's `sys/ioctl.h` has none).
  - `TIOCGWINSZ` asks per fd: a pipe or a file is ENOTTY (#279), where `tty_get` answered 80x24.
  - `TIOCSWINSZ` is a no-op on a terminal (the size is the page's) and ENOTTY elsewhere.
- **`isatty`:** `winsize(fd) == 0`.
- **`tcflush`:** TCIFLUSH/TCIOFLUSH re-apply the current termios with TCSAFLUSH; TCOFLUSH has nothing to drop.
- **`tcdrain`:** succeeds on a valid fd, since output is written at once.
- **Older kernels:** a kernel without `slicc_tty` answers ENOSYS, and every call falls back to the -20 code (`tty_get`/`tty_set`, `fd_fdstat` for `isatty`).

### -21: `../slicc_stat_owner.c` — file type from `slicc_fs`

`fstat` and `fstatat` (so `stat`/`lstat`) already took the permission bits from slicc-kernel's `slicc_fs` `fd_mode`/`path_mode`.

When that mode also carries type bits (Linux numbering, `& 0170000`), -21 maps them to WASIX's `__mode_t.h` and they replace the WASI filetype: FIFO 0o010000 becomes 0o140000, socket 0o140000 becomes 0o160000, and the rest are equal. WASI has no FIFO filetype, so a pipe can only be `S_ISFIFO` this way (ruby's popen `r+`, python's asyncio pipe transports).

A mode without type bits keeps the WASI filetype, which is how every kernel before r99's `fd_mode`-on-pipes change behaves (`test/fifo.c`).

## -22: libc generation marker, and the itimer helper made static

- **`slicc.libc` custom section.** Every `crt1*.o` (crt1, crt1-command, crt1-reactor; 5 variants) is merged (`wasm-ld -r`) with an object holding a wasm custom section `slicc.libc` = `wasix-sysroot <version>`, here `wasix-sysroot 2025.9.30-22`. Every program links a crt1, and wasm-ld copies custom sections into the output, so every program built on -22 or later carries it; it costs nothing at run time. slicc-kernel reads it to tell libc generations apart: an interrupted `clock_nanosleep` must get ENOTSUP on -17/-18 and EINTR on -19+ (which also fixes poll/select), and nothing in a binary told them apart before (r99, slicc-kernel#263). A program without the section is -21 or older.
  - It is a real custom section, written as top-level assembly (`.section .custom_section.slicc.libc`). `__attribute__((section(".custom_section.…")))` in C makes a data segment of that name, which wasm-ld drops.
  - It survives everything our recipes do after linking (checked on a static and a dynamic-main program): `wasm-opt` `-O3`/`-Oz` with `--strip-debug`/`--strip-producers`, `--strip`, `--strip-dwarf`, `--asyncify`, and `llvm-strip` with and without `--strip-all`. wabt's `wasm-strip` would remove it; no recipe uses it.
  - Side modules (`.so`) link no crt1 and carry no marker; the main program's marker is the one that counts.
  - `test/r22.mjs` reads it from the probe it links (`ctx.wasm`).
- **`__homescoop_itimer_real_left` is static.** `getitimer()` moved from `getitimer.c` into `setitimer.c`, so the time-left helper no longer needs external linkage; `build-incremental.sh` deletes `getitimer.o` from every `libc.a` (after checking that the new `setitimer.o` defines what it did). A dynamic-main exports hidden symbols too: wasix-python 3.14.2-15 on -21 exports `__homescoop_itimer_real_left` next to `getitimer`/`setitimer`.

## -23: `ioctl.c` — Linux window-size request numbers (homescoop#250)

WASIX numbers `TIOCGWINSZ`/`TIOCSWINSZ` 0x101/0x102 (`__header_sys_ioctl.h`); Linux uses 0x5413/0x5414. Code that hard-codes the Linux number (common in Python libraries and ctypes snippets) fell through to `ioctl`'s default branch: EINVAL. -23 accepts both numbers for both requests, with the same per-fd behaviour (`slicc_tty.winsize`: the size on a terminal, ENOTTY on pipes and files, EBADF on a closed fd). `slicc_tty.h` defines them as `SLICC_LINUX_TIOCGWINSZ`/`SLICC_LINUX_TIOCSWINSZ`, so the public headers keep WASIX's values. `TCGETS`..`TCSETSF` were already Linux-numbered (-21). `ioctl.o` is still built by the -21 section of `build-incremental.sh`; `test/r23.c` checks both numbers on a pty, pipes, a file and a closed fd.

## -23: `fork.o`, `_Fork.o` in the PIC variants (homescoop#253)

Upstream wasix-libc v2025-09-02.1 compiles musl's `fork.c`, `_Fork.c` and `vfork.c` to empty objects under `#if !defined(__wasm_exception_handling__)`, in all four EH variants, because a WASIX fork is an asyncify unwind and rewind. The -14 full build (`build.sh`) put the asyncify tree's `fork.o`/`_Fork.o` back into `sysroot-eh` and `sysroot-exnref-eh`, but not into the PIC trees, since those objects are not position-independent. So a PIC program calling `fork()` did not link (`undefined symbol: fork`), and the dynamic wasix-python has no `os.fork`.

- **What -23 does.** `build-incremental.sh` compiles `fork.c` and `_Fork.c` from the libc tag with `-fPIC` and the musl internal headers, and replaces the empty members in `sysroot-ehpic` and `sysroot-exnref-ehpic`. It checks that the old members defined nothing, and that `fork`, `_Fork` and `_fork_internal` are defined afterwards. Nothing in them is EH-specific.
- **Asyncify.** As in the static trees, `fork()` works only in a program that `wasm-opt --asyncify` instrumented (`asyncify-imports@wasix_32v1.proc_fork`) on every frame between the entry point and `fork()`. slicc-kernel answers `proc_fork` ENOSYS in a program without the asyncify exports, so `fork()` returns -1 ENOSYS there.
- **Side modules.** After a `dlopen`, the child of a fork traps on its first call into the side module (`table index is out of bounds`): the kernel does not rebuild the child's dynamic-linking state yet (slicc-kernel#337). Side modules are not asyncified, so a fork with a side-module frame on the stack is not supported either.
- **vfork is unchanged.** EH `unistd.h` makes `vfork()` a setjmp macro (`__vfork_internal`, `proc_fork_env`), so there is no `vfork` symbol in any EH variant. Their `vfork.o` also defines `__vfork_restore`, which `_Exit` and the `exec*` family need, so it is not replaced.
- **Probe.** `test/r23fork.c` (`run-modes.mjs --probe r23fork`; the probe asyncified, `r23fork-sync` the same program without asyncify; `--variant ehpic` also builds `test/r23fork-side.c` as a side module).

## -24: `chown.c`, `../slicc_stat_owner.c` — file owners from slicc-kernel (K3)

slicc-kernel K3 (slicc-kernel#362, #368) stores an owner per path when `createKernel({ users })` is `'report'` or `'enforce'` and exposes these `slicc_fs` imports. Each returns 0 or a WASI errno:
- `path_chown(dirfd, path, len, uid, gid, flags)` and `fd_chown(fd, uid, gid)`: -1 keeps an id, flags 1 is no-follow (lchown);
- `path_owner(dirfd, path, len, flags, out)` and `fd_owner(fd, out)`: write u32 uid then u32 gid at `out`; flags 1 is lstat;
- `path_filestat_owner(dirfd, lookupflags, path, len, filestat, owner)` and `fd_filestat_owner(fd, filestat, owner)`: the WASI filestat and the owner in one call.

The members change as follows:

- **`chown.c` replaces `chown.o`, `fchown.o`, `lchown.o` and `fchownat.o`** (upstream: 0 for ids 0/-1, ENOSYS for anything else, nothing stored). `chown`/`lchown` resolve the path against the preopens as `chmod` does; `fchownat` takes `AT_FDCWD`, absolute paths and `AT_SYMLINK_NOFOLLOW`, and any other flag is EINVAL. The kernel enforces the rules (root sets anything; an owner may set its group to its egid or a supplementary group; EPERM otherwise; Linux's S_ISUID/S_ISGID clearing). With users `'off'` the kernel still validates (ENOENT/ENOTDIR, EBADF) and changes nothing. ENOSYS (a kernel without the imports) keeps upstream's answer.
- **`slicc_stat_owner.c`:** `fstat` calls `fd_filestat_owner(fd, filestat, owner)` and `fstatat`/`stat`/`lstat` `path_filestat_owner(dirfd, lookupflags, path, len, filestat, owner)`, drop-ins for `fd_filestat_get`/`path_filestat_get` (same filestat layout, same preview1 lookup flags: 1 follows a symlink) that also write u32 uid and u32 gid; those become `st_uid`/`st_gid`. The `slicc_fs` mode is read as before.
  - A kernel with `path_owner`/`fd_owner` but without the combined calls (ENOSYS) gets the WASI filestat plus `path_owner`/`fd_owner` (flags 1 is lstat there); the ENOSYS is remembered.
  - With users `'off'` the kernel answers ENOTSUP at once, and older kernels ENOSYS for every owner call: then the process makes no more owner calls and uses the plain WASI filestat with `getuid()`/`getgid()` (-15's view).
  - Devices are root's; pipes and sockets the caller's.
- **Cost** (`run-bench.mjs --probe bench-stat`, 2000 files in 100 directories, a git-status-like readdir+lstat walk, then stat and fstat, 20 interleaved rounds, medians, -24 against -23 on the Node entry): with the combined calls, `'enforce'` is +1.2% (walk), +3.8% (stat), +3.8% (fstat), the same as `'off'` (+1.4%, +3.5%, -0.2%) in the same session, i.e. noise. The two-call path (a kernel without the combined calls) costs +7% to +10%; kernels without any owner import are within noise.
- **Probe:** `test/r24.c` as root and as a kernel user, `R24_USERS=report|enforce|off`, and `--allow-absent` for a kernel without the imports.

### -24: `posix.c` — `linkat(AT_FDCWD, …)` passed the new path twice

`__wasilibc_link`, which `linkat` uses when both directory fds are `AT_FDCWD` or both paths are absolute, resolved both paths with `find_relpath`, which returns a pointer into one thread-local buffer. The second call overwrote the first, so the kernel's `path_link` got the new path as the old one too and answered ENOENT (found by the slicc-kernel 1.58.1 cert: `from="/mnt/t/q3", to="/mnt/t/q3"`). `link()` and `linkat` with a real directory fd on either side were right: `link()` already used `find_relpath_alt` for the old path, and the mixed forms resolve only one path. -24 uses `find_relpath_alt` for the old path in `__wasilibc_link` too. `test/r24link.c` links on a tmpfs mount (hard links need slicc-kernel >= 1.58.0 and a driver with `links`) with `link`, `linkat(AT_FDCWD, …)` relative and absolute, `AT_SYMLINK_FOLLOW`, and a directory fd on either side.

## -25: `faccessat.c` — access through slicc-kernel (K3(b)), `AT_EACCESS`, `linkat` flags

slicc-kernel 1.63.0 (K3(b2)) has `slicc_fs.path_access(dirfd, path, len, amode, flags)`: amode is `F_OK`/`R_OK`/`W_OK`/`X_OK`, flags 1 is no-follow and 2 is "effective ids". Under users `'enforce'` it applies Linux's permission rules (owner, group, other; search permission along the path, which `F_OK` checks too; root bypasses everything but `X_OK` on a file without any x bit). Under `'off'` and `'report'` it resolves the path; with owners on (`'report'` included) `X_OK` on a device is EACCES.

- **`faccessat.c` replaces cloudlibc's `faccessat.o`** (`__wasilibc_nocwd_faccessat`, which `access`, `faccessat` and the at-fdcwd paths all reach). It validates amode and flags (EINVAL), then asks `path_access`; ENOSYS (a kernel before 1.63.0) is remembered for the process, and the old check runs: `path_filestat_get` (now honouring `AT_SYMLINK_NOFOLLOW`) and the directory fd's WASI rights.
- **`AT_EACCESS` is 0x200** in `__header_fcntl.h` (Linux's value). wasi-libc defined it as 0, so it could not be told from a plain `faccessat`. Programs are linked statically against the libc from their own headers, so old binaries keep passing 0 (real ids), which is what they got before. `faccessat` also accepts `AT_SYMLINK_NOFOLLOW` now (upstream: EINVAL).
- **`eaccess`/`euidaccess`** are defined in the same object (`faccessat(AT_FDCWD, path, mode, AT_EACCESS)`) and declared in `unistd.h` under `_GNU_SOURCE` (wasi-libc hid them).
- **`at_fdcwd.c`: `linkat`** returns EINVAL for flags other than `AT_SYMLINK_FOLLOW` (0x2 in WASIX, 0x400 on Linux), as Linux does; it passed them on, and the kernel ignored them.
- **`open` rights:** cloudlibc's `openat` asks for base rights without `FD_WRITE` (and without the other write rights) for `O_RDONLY`, and slicc-kernel takes `FD_WRITE` as the write request, so no change is needed: under `'enforce'` a 0444 file opens `O_RDONLY` and is EACCES for `O_WRONLY`/`O_RDWR` (`test/r25.c`).
- **Probe:** `test/r25.c` as root (with a `seteuid(1000)` to tell `access` from `eaccess`) and as a kernel user, `R25_USERS=enforce|report|off`, and `--allow-absent` on a kernel without `path_access`.

## -26: an empty path is ENOENT (`chdir.c`, `posix.c`, `at_fdcwd.c`; homescoop#281)

Linux and POSIX give ENOENT for an empty pathname. Up to -25 libc's path resolution (`__wasilibc_find_relpath_alloc`, which -18's `chdir.c` defines) joined `""` to the cwd, so `open("")`, `stat("")`, `access("")`, `chmod("")`, `chown("")`, `opendir("")`, … acted on the current directory, and `mkdir("")`/`unlink("")` gave EEXIST/EISDIR. The kernel answered the `*at(dirfd, "")` forms for the directory itself until slicc-kernel 1.71.1 (slicc-kernel#404).

- **`chdir.c`:** `__wasilibc_find_relpath_alloc` returns -1 with ENOENT for `""`. Every path call that resolves through the cwd and the preopens goes through it (`posix.c`, `chown.c`, `chdir`, `realpath`).
- **`posix.c` / `at_fdcwd.c`:** `symlink("", x)` and `symlinkat("", …)` are ENOENT (an empty target), as on Linux.
- **`at_fdcwd.c`:** `fstatat(fd, "", st, AT_EMPTY_PATH)` (Linux's 0x1000; the WASIX headers do not define it) is `fstat(fd)`, and `fstatat(AT_FDCWD, "", st, AT_EMPTY_PATH)` is `stat(".")`, since the kernel now answers an empty path with ENOENT.
- No new archive members: `posix.o`, `at_fdcwd.o` (-16's section) and `chdir.o` (-18's) are rebuilt from the patched sources.
- **Probe:** `test/r26.c`: 23 calls on `""` (through the cwd, and `fstatat`/`openat`/`mkdirat` on a dirfd, which need slicc-kernel ≥ 1.71.1) are ENOENT; `AT_EMPTY_PATH` is `fstat`; `"."`, `"/"` and a relative name still work.

## -27: `utimens.c` (utimensat, futimens), `cputime.c` (clock, times, getrusage), `emulated_clock.c` (homescoop#294)

- **File times.** The shipped `utimensat.o` (`__wasilibc_nocwd_utimensat`) and `futimens.o` are cloudlibc's, and clang 21 compiles their `utimens_get_timestamps` inline helper so that the `times == NULL` branch and the second timespec's `UTIME_NOW`/`UTIME_OMIT` cases are gone (seen by decompiling the shipped objects and a fresh `-O2` build of the same source). So:
  - NULL read the timespecs at address 0 and sent `ATIM|MTIM` with 0/0: the file got 1970 (static), or -1 without errno (PIC);
  - `times[1]` NOW/OMIT failed the range check and returned -1 **without setting errno**;
  - `utime`/`utimes` (posix.c) reach the same function.
  `utimens.c` is a plain rewrite of the same logic: NULL → `ATIM_NOW|MTIM_NOW`; UTIME_NOW → the `_NOW` flag; UTIME_OMIT → the flag left unset; anything else must be a valid timespec (EINVAL otherwise, with errno set). It replaces `utimensat.o` and `futimens.o`. Found by slicc-kernel's fs lane (xcuw) tracing every import of slicc-kernel#457's probe.
- **CPU times.** WASIX's `times()` put the wall clock's seconds and microseconds into `tms_stime`/`tms_utime` (and copied them into the children's fields) and returned nanoseconds; `getrusage(RUSAGE_SELF)` reported the monotonic clock in both `ru_utime` and `ru_stime` (with `tv_usec` off by 10^6); musl's `clock()` returned microseconds where `CLOCKS_PER_SEC` is 10^9; and `libwasi-emulated-process-clocks.a`'s `clock`/`__clock` (which every wasixcc program links, and wins over libc's in a static link) counted the wall time since the program started. `cputime.c` replaces `clock.o`, `times.o` and `getrusage.o`: all three read `CLOCK_PROCESS_CPUTIME_ID` (slicc-kernel ≥ 1.62, #399). `clock()` is nanoseconds (`CLOCKS_PER_SEC`), `times()` ticks of 1/100 s (`sysconf(_SC_CLK_TCK)`) and returns the monotonic time in ticks, `getrusage(RUSAGE_SELF)` fills `ru_utime`; system and children's times are 0 (the kernel exposes none yet), `RUSAGE_CHILDREN` is all 0, any other `who` EINVAL. `emulated_clock.c` makes the emulated library's `__clock`/`clock` the process CPU time too.
- **Probe:** `test/r27.c`: 16 file-time cases checked with `stat` (mtime; slicc-kernel reports atime as the mtime), and a 0.5 s busy loop and a 0.4 s sleep whose `clock()`, `times()` and `getrusage()` deltas must match `clock_gettime(CLOCK_PROCESS_CPUTIME_ID)` within 0.05 s, the loop 0.45-0.8 s. That the sleep adds no CPU time is the kernel's to keep: slicc-kernel ≥ 1.77.0 (#468) counts only the time the thread runs; older kernels count sleeps, and `R27_SLEEP_IS_CPU=1` skips that check on them.

## -28: `sigmask.c` (pthread_sigmask, sigpending; slicc-kernel #460)

- **Up to -27:** WASIX's `pthread_sigmask` (musl `src/thread/pthread_sigmask.c`, WASI branch) returned 0 and did nothing: no mask kept, `*old` not written, no check of `how`. `sigprocmask` calls it. `sigpending` (`src/signal/sigpending.c`) returned `EINVAL` as its value. The host delivered every signal at once.
- **`sigmask.c`** replaces `pthread_sigmask.o` and `sigpending.o` (upstream `sigprocmask.o` stays):
  - `pthread_sigmask(how, set, old)` calls the import `slicc.sigmask_set(how, set_lo, set_hi, old_ptr) → errno`, agreed with slicc-kernel's signals lane (df8, slicc-kernel #460). `how` is musl's `SIG_BLOCK` 0 / `SIG_UNBLOCK` 1 / `SIG_SETMASK` 2. The set is the first 64 bits of `sigset_t` (bit `sig-1`) split into two u32s, with `SIGKILL`, `SIGSTOP` and musl's internal 32-34 cleared. `old_ptr` always points at a u64 that receives the thread's previous mask. A NULL `set` is a query: `SIG_BLOCK` with an empty set. A bad `how` with a set is EINVAL.
  - The mask is per thread in the kernel, which holds a blocked signal as pending and delivers it, once unblocked, before `sigmask_set` returns.
  - `sigpending(set)` calls `slicc.sigpending_get(ptr) → errno` (a u64 at `ptr`), errors as -1 with errno.
  - The libc keeps a copy in the thread-local `__slicc_sigmask`, set from the kernel's answer each call. On a kernel without the imports (ENOSYS) the copy is the mask: old masks read back right and the copy survives `fork`, but signals are still delivered at once and `sigpending` gives the empty set.
- **Waiting with a mask (`sigmask.c`, `pselect.c`, `sigaction.c`).** Up to -27 `pselect` ignored its `sigmask`, `sigsuspend` returned the value EINVAL, and there was no `ppoll`. Once masks are real, a program that blocks signals and lets only the wait unblock them would never see them: gnupg's daemons (gpg-agent, dirmngr, scdaemon, keyboxd: `npth_sigev_*` blocks HUP/INT/TERM/USR1/USR2 for good and waits in `npth_pselect(…, npth_sigev_sigmask())`), and openssh's ssh, ssh-agent and sshd (block, then `ppoll(…, &osigset)`, which our openssh build emulates with `pselect`).
  - `pselect` with a `sigmask`, the new `ppoll`, and `sigsuspend` call `slicc.sigmask_poll(set_lo, set_hi, in_ptr, out_ptr, nsubscriptions, nevents_ptr) → errno`. The kernel swaps the thread's mask and polls in one call, so a signal can't slip in between: a pending signal that the mask unblocks is delivered at once (EINTR, no poll), one that arrives during the wait interrupts it, and the old mask is back on return. `nsubscriptions` 0 waits for a signal (`sigsuspend`; `pselect`/`ppoll` with nothing to wait for and a mask).
  - Without the import (ENOSYS) the libc swaps the mask with `pthread_sigmask` around the poll (`sigaction.c`'s `__wasm_signal` counts handler runs, so a signal delivered by the swap ends the wait at once), and `sigsuspend` waits in 50 ms polls until a handler has run.
  - `sigtimedwait` and `sigwaitinfo` return -1 with ENOSYS and `sigwait` returns ENOSYS. Up to -27 the first two returned the value 22 without errno, so `sigwait` returned 0 with a signal number from an uninitialised `siginfo_t`. A real `sigwait` needs a kernel call that takes a pending signal without running its handler (slicc-kernel #520).
  - `sigmask.c` also replaces `sigsuspend.o`, `sigtimedwait.o`, `sigwaitinfo.o` and `sigwait.o`, and adds `ppoll`.
- **Probe:** `test/r28.c` (asyncified for `fork`).
  - Block `SIGUSR1`, `kill(getpid())`: the handler does not run and `sigpending` shows it; unblock: it has run when `sigprocmask` returns.
  - `SIG_SETMASK` with `SIGKILL`/`SIGSTOP`/`SIGUSR2` keeps only `SIGUSR2`; the old masks of `SIG_BLOCK` and `SIG_SETMASK` are right; a bad `how` is EINVAL.
  - A thread blocking `SIGUSR1` and sent it with `pthread_kill` keeps it pending for itself (main's `sigpending` is empty) and runs the handler on unblock.
  - A forked child and the program it `exec`s keep the mask.
  - The probe asks the import directly whether the kernel has it, and checks the libc-only behaviour when it does not; `R28_KERNEL_MASK=1` requires the kernel's.
- **Probe:** `test/r28w.c` (asyncified): a pending blocked SIGUSR2 makes `pselect(…, &empty)` return EINTR at once with the handler run and SIGUSR2 still blocked after; `sigsuspend(&empty)` wakes when a child sends SIGUSR1; gpg-agent's pattern (HUP/TERM/INT blocked, `pselect` on a pipe for 10 s with the old mask) and ssh's (`ppoll(…, &osigset)`) get the signal within 3 s; `ppoll` reports a readable pipe; `sigtimedwait`/`sigwaitinfo`/`sigwait` are ENOSYS. `R28_KERNEL_MASK=1` requires `slicc.sigmask_poll`. The window between the mask swap and the wait is the kernel's to test (slicc-kernel's test hook).


## -29: `poll.c`, `sigmask.c`'s `ppoll`, `epoll.c` (homescoop#394, #443)

- **`poll.c`** replaces cloudlibc's `poll.o` (wasix-libc `v2025-09-02.1` `libc-bottom-half/cloudlibc/src/libc/poll/poll.c`, BSD-2-Clause, licence in the package's `LICENSE`), and `sigmask.c`'s `ppoll` (-28, which copied it) changes the same way:
  - **Up to -28** an entry with a valid fd whose `events` has neither `POLLRDNORM` (`POLLIN`) nor `POLLWRNORM` (`POLLOUT`) failed the whole call with ENOSYS, because cloudlibc decomposes entries into WASI read/write subscriptions and can't see `POLLERR`/`POLLHUP`/`POLLNVAL` otherwise. Linux takes such an entry (OpenSSH's client loop passes `events` 0 for idle channels; #386 builds OpenSSH's own `ppoll` to get around it).
  - **Now** the entry gets no subscription. Its fd is checked with `fd_fdstat_get`: a bad one is `POLLNVAL`, and then the call polls the rest once without waiting, as Linux returns at once for a ready entry. Otherwise its `revents` stays 0 (no `POLLHUP`/`POLLERR` for it).
  - A call whose entries are all of this kind, with no timeout, waits until a signal handler runs (EINTR), as on Linux; up to -28 it was ENOSYS, and `poll(NULL, 0, -1)` / `ppoll(NULL, 0, NULL, NULL)` was ENOTSUP. `poll` waits in 50 ms polls of the clock, counting handler runs like -28's `sigsuspend` fallback.
- **`epoll.c`** replaces `epoll.o` (wasix-libc's `libc-top-half/musl/src/linux/epoll.c`, a WASIX addition):
  - `epoll_ctl` maps Linux's `EPOLL_CTL_ADD` 1 / `EPOLL_CTL_DEL` 2 / `EPOLL_CTL_MOD` 3 (the header's numbers) to WASIX's `__WASI_EPOLL_CTL_ADD` 0 / `MOD` 1 / `DEL` 2; any other op is EINVAL. A NULL event for ADD/MOD is EFAULT. Errors are -1 with `errno`. Up to -28 the op went through untranslated and the errno was the return value.
  - `epoll_wait`/`epoll_pwait` copy the whole `data` back from `data2`, where `epoll_ctl` stores `data.u64`. Up to -28 they picked `ptr`, then `fd` (the registered fd), then `data1`, so a value whose low 32 bits are 0 came back as the fd. `maxevents` above 64 is honoured (a heap buffer; the kernel caps it at 4096), and 0 or less is EINVAL. Up to -28 it was cut to 64.
  - `epoll_pwait` with a mask swaps it in with `pthread_sigmask` around the wait and returns EINTR at once if that ran a handler. The kernel has no masked epoll wait, so a signal that arrives between the swap and the wait is handled but doesn't end it.
  - `epoll_create1` honours `EPOLL_CLOEXEC` (`fcntl(F_SETFD)`) and rejects other flags; `epoll_create(size)` with `size` ≤ 0 is EINVAL, as on Linux.
  - slicc-kernel ≥ 1.95.0 (slicc-kernel#683) has WASIX epoll. It also accepts -28's numbering: its op 1 adds an unregistered fd and modifies a registered one, so `EPOLL_CTL_MOD` of an unregistered fd adds it there instead of ENOENT until slicc-kernel#684 drops that.
- **Probe:** `test/r29.c` (asyncified for `fork`):
  - `poll` and `ppoll` with a readable pipe (`POLLIN`), an idle pipe with `events` 0 and with `POLLPRI`, and fd -1: 1, only the first ready; two `events` 0 entries with a 200 ms timeout wait it out and return 0; a closed fd with `events` 0 next to an idle pipe: 1 and `POLLNVAL` at once (of 5 s); an entry with only bit 0x4: 0.
  - epoll (when the kernel has it; `R29_EPOLL=1` requires it): `EPOLL_CLOEXEC` set; ADD, ADD again EEXIST, a readable pipe reported with `data.u64` 0x100000000, MOD to `data.u64` 0 reported as 0, DEL, DEL again ENOENT, op 7 EINVAL, a pipe as the epoll fd EINVAL for ctl and wait, an idle wait 0; 70 readable pipes in one `epoll_wait(…, 100, …)`, all 70 distinct. With kernel masks: SIGUSR1 blocked and pending, `epoll_pwait(…, 3000, &empty)` is EINTR at once with the handler run and SIGUSR1 blocked again after.
  - slicc-kernel 1.93.0's signal fixes (slicc-kernel#596), with kernel masks on ≥ 1.93.0: signal 40 blocked in main is blocked in a new thread, in a forked child and in the program it `exec`s; `r29 bothterm` (main and a thread block SIGTERM, main `pthread_kill`s the thread, the thread unblocks) ends by SIGTERM, so bash prints "Terminated" and `$?` is 143. A fork from a non-main thread doesn't run the child's code on these kernels (slicc-kernel#520), so "a fork takes the forking thread's mask" is covered only from the main thread (r28).

## -30: `sem.c`, named semaphores through slicc-kernel (homescoop#486, slicc-kernel#717)

- **Up to -29**, musl's `sem_open` opened `/dev/shm/sem.<name>` and mapped it `MAP_SHARED`. In slicc-kernel each process has its own wasm memory, so the mapping isn't shared and a named semaphore can't synchronise processes. The kernel's `/dev/shm` also didn't keep files (slicc-kernel#716), so `sem_open` failed with ENOENT. CPython's `multiprocessing` locks are named semaphores.
- **`sem.c`** replaces `sem_open.o` (with `sem_close`), `sem_unlink.o`, `sem_wait.o`, `sem_trywait.o`, `sem_timedwait.o`, `sem_post.o`, `sem_getvalue.o`, `sem_init.o` and `sem_destroy.o`. It `#include`s those musl sources under `__musl_*` names, including `__shm_mapname` (so there's no clash with `shm_open.o`), and dispatches:
  - **A named semaphore** is a malloc'd `sem_t` with `__val[3]` = 0x5c1cc5e3 and `__val[0]` = the kernel handle. `sem_init` clears `__val[3]`, so an unnamed one never matches. Tagged ones go to the imports from slicc-kernel#718 (README "Named semaphores"):
    - `slicc.sem_open(name_ptr, name_len, oflag, mode, value, handle_out)`, with oflag kernel bits 1 = O_CREAT, 2 = O_EXCL and mode `& 0777`;
    - `sem_close(handle)`, `sem_unlink(name_ptr, name_len)` and `sem_post(handle)`;
    - `sem_wait(handle, how, clock, deadline_ns)`: how 0 blocks, 1 tries, 2 waits until an absolute CLOCK_REALTIME deadline. A negative `tv_sec` is a deadline of 0; a bad `tv_nsec` is EINVAL;
    - `sem_getvalue(handle, value_out)`.

    Each returns a WASI errno, which the libc turns into -1 and `errno`.
  - **Repeat opens:** a table of 256 entries (handle, `sem_t *`, count). A second `sem_open` that gets the same handle back returns the same pointer, and `sem_close` frees the `sem_t` when its count reaches 0. The table lives in program memory, so it follows `fork` (the kernel copies the handles) and is fresh after `exec` (the kernel drops them).
  - **Names** pass through unchanged; the kernel checks them with musl's `__shm_mapname` rules.
  - **`ENOSYS`** from `slicc.sem_open`/`sem_unlink` (an older kernel) falls back to musl's file-based code.
  - **Unnamed** semaphores use musl's futex code, unchanged.
- **Probe:** `test/r30.c` (asyncified for `fork`), as in the checklist. `R30_SEM=1` requires the kernel's imports.

## -30: `fcntl.c` record locks, musl `lockf.c` (homescoop#407, slicc-kernel#722)

- **Headers:** `__header_fcntl.h` gets `F_GETLK (12)`, `F_SETLK (13)`, `F_SETLKW (14)` (musl's 64-bit numbers, the ABI's) and `F_RDLCK (0)`/`F_WRLCK (1)`/`F_UNLCK (2)`. `unistd.h` declares `lockf` (and `lockf64`) outside the "WASI has no POSIX file locking" guard.
- **`fcntl.c`** (the -15 F_SETFD fix) handles the three commands. It checks `l_type`, then calls `slicc.fcntl_lock(fd, cmd, flock_ptr) → WASI errno` with the struct as the program gave it; the kernel resolves `l_whence`. `_Static_assert`s pin the cmd, `l_type` and `SEEK_*` numbers and the `struct flock` layout to the ABI on #722. On ENOSYS it checks the fd (EBADF) and answers locally: granted, with F_GETLK giving `F_UNLCK`. `build-incremental.sh` now compiles it (static and PIC) and replaces `fcntl.o`.
- **`lockf.o`** is musl's `src/misc/lockf.c`, over `fcntl`, so it reaches the kernel too.
- **Probe:** `test/r30lock.c` (asyncified for `fork`). `R30_LOCK=1` requires the kernel's import.

## -31: `common/net.h`, `poll.c`, `sem.c` (homescoop#515, #464, #500)

- **`common/net.h`** is wasix-libc's `libc-bottom-half/cloudlibc/src/common/net.h` (v2025-09-02.1, BSD-2-Clause) with two fixes. `build-incremental.sh` recompiles `getsockname`, `getpeername`, `accept`, `recvfrom`, `recvmsg`, `bind`, `connect`, `sendto` and `sendmsg` from wasix-libc's sources with `-I patches` ahead, so `<common/net.h>` is this copy, and replaces their members.
  - **`wasi_to_sockaddr`, AF_UNIX:** upstream filled a local `sockaddr_un`, set `*addrlen` and never copied it into `addr`, which the function had zeroed (family 0, empty path). Now it zero-fills, copies up to 107 path bytes, and copies `MIN(len, *addrlen)` bytes out. The length is `offsetof(sun_path) + strlen + 1`, or `sizeof(sa_family_t)` for an unnamed socket, as Linux gives.
  - **`sockaddr_to_wasi`, AF_UNIX:** upstream took the whole length after `sun_path` as the path and refused more than 107 bytes, so `bind(…, sizeof(struct sockaddr_un))` failed. Now the path ends at its NUL within the given length. Errors are EINVAL (bad length) or EAFNOSUPPORT (another family), not -1, which the callers stored in errno.
- **`poll.c`** now holds both `poll` and `ppoll` (moved out of `sigmask.c`) over one core.
  - An entry with no read/write interest is subscribed for reading (or for writing, if the fd has no read right), with a tag in the userdata. Its event reports only `POLLHUP` (a hangup on read) or `POLLERR` (a write end whose reader is gone), and `POLLNVAL`/`POLLERR` for errors. Plain readiness reports nothing.
  - If that's the only thing that woke the call, the next wait leaves those entries out for at most 50 ms (the monotonic clock, never past the deadline), then re-checks them. So a hangup that comes later in the call is still reported, within about 50 ms, at the cost of one wakeup per 50 ms while such an entry stays ready.
- **`sem.c`:** the named-semaphore table grows (realloc, from 16) instead of stopping at 256.
- **Probe `test/r31.c`:** AF_UNIX addresses (bind/listen/connect/accept, getsockname/getpeername of both ends, a short buffer), events-0 hangup and POLLERR for `poll` and `ppoll`, and 1000 named semaphores.

## -32: `epoll.c`, `sigmask.c`, `sigaction.c` (homescoop#466, #520, #740)

- **`epoll.c`:** `epoll_pwait` with a mask calls `slicc.sigmask_epoll_wait(set_lo, set_hi, epfd, events, maxevents, timeout_ns, nevents)` (slicc-kernel#783). The set drops SIGKILL, SIGSTOP and musl's 32-34, as `pthread_sigmask` does. The first ENOSYS switches the process to -31's swap path for good.
- **`sigmask.c`:** `sigtimedwait` calls `slicc.sigwait(set_lo, set_hi, timeout_ns, sig_ptr)` (slicc-kernel#786, #801):
  - a NULL timeout is all bits set (forever), and `{0, 0}` is 0;
  - `tv_sec < 0` or `tv_nsec` outside 0..999999999 is EINVAL;
  - EINTR (a handled signal outside the set) is retried with the time left, as musl's `sigtimedwait` does;
  - EAGAIN at the timeout, and ENOSYS on an older kernel, come back as -1 with errno.
  `sigwaitinfo` is `sigtimedwait` with no timeout. `sigwait` returns the error number, and leaves errno alone.
- **`sigaction.c`:** the first `sigaction` call in a process (`signal`, `sigset` and `bsd_signal` go through it) reads `slicc.sigaction_inherited(ign_ptr)` once (slicc-kernel#841). It sets SIG_IGN for each set bit (signal n = bit n-1, never SIGKILL, SIGSTOP or 32-34) whose entry is still SIG_DFL. ENOSYS keeps the defaults.
  - The libc's table is read only through `sigaction`, so this matches seeding it before constructors, with no constructor-order dependency.
  - The kernel already applies the inherited ignores itself.
- **Probe `test/r32.c`** (asyncified; `R32_KERNEL=1` requires the three imports):
  - **epoll:** 200 rounds of a SIGUSR1 sent by a thread at a random 0-3 ms into `epoll_pwait(…, 2000, &empty)` with SIGUSR1 blocked outside. Every round is EINTR at once, none waits out 2 s, and SIGUSR1 is blocked after. A ready fd gives its event.
  - **sigwait:** `sigwait`/`sigwaitinfo` take a pending blocked signal without its handler, with `si_code` SI_USER. `sigtimedwait` gives EAGAIN on time at 200 ms, at once for `{0,0}`, and EINVAL for `tv_nsec` 1e9. A handled SIGALRM 200 ms into a 600 ms wait runs and the wait goes on to EAGAIN at 600 ms. Another thread's `kill(getpid())` is taken.
  - **SIGCHLD:** a child is a zombie by default, reaped (ECHILD) under `SA_NOCLDWAIT`, and a zombie again after SIG_DFL.
  - **Inherited:** under bash `trap '' PIPE USR2 CHLD`, `exec r32 inherit` reads SIG_IGN for PIPE, USR2 and CHLD and SIG_DFL for TERM, the inherited CHLD ignore reaps, and a handler installed over it runs.
  - **On a kernel without the imports:** the -31 behaviour, line by line.
- **`test/r28w.c`:** skips its three ENOSYS sigwait lines on a kernel with `slicc.sigwait`, since a real `sigwaitinfo` of an empty-handed set would wait forever. Those lines are r32's now.

## -33: `proc_raise_interval2.c` (homescoop#943)

- **What it is:** `__wasi_proc_raise_interval2`, the public wrapper for `wasix_32v1.proc_raise_interval2`, written in the style of wasix-libc's generated `__wasixlibc_real.c`, plus its `api_wasix.h` declaration.
- **Where it goes:** `sysroot-ehpic` and `sysroot-exnref-ehpic` only, the two trees where -32 had it, from wasix-python's setitimer libc patch in the -14 base.
- **Why:** upstream v2026-07-03.1 has neither. libc's own setitimer doesn't need it, since it imports the call privately (`setitimer.c`), but wasix-python's build checks for it.
- **Test:** `test/globals.mjs` fails on any defined global, or any non-C++ header, that a candidate drops against npm -32.

## -34: `sigmask.c`, `sigaction.c`, `flock.c`, `poll.c` (homescoop#770, #629, #559; slicc-kernel#892, #893)

- **`sigmask.c`:** `sigtimedwait` (so `sigwaitinfo`) calls `slicc.sigwait_info(set_lo, set_hi, timeout_ns, info_ptr)` (slicc-kernel#911, 1.114.0) with `struct { u32 size; i32 signo, code, pid; u32 uid; i32 status; }`, `size` 24 in and the filled size out. `siginfo_t` gets `si_code` (SI_USER, SI_TKILL, CLD_*), `si_pid`, `si_uid` and, for SIGCHLD, `si_status`, each only if the kernel filled it. The first ENOSYS is remembered, and the -32 path (`slicc.sigwait`, SI_USER with pid and uid 0) runs from then on. `__slicc_fill_siginfo` is shared with `sigaction.c`.
- **`sigaction.c`:** an `SA_SIGINFO` handler is called as `sa_sigaction(sig, &si, ctx)`. Up to -33 `__wasm_signal` called it through the one-argument `sa_handler` type: wasm's `call_indirect` refuses a mismatched type, and the handler never ran. `si` comes from `slicc.siginfo_take(sig, info_ptr)`, the sender of the instance just delivered. ENOENT (none recorded) or ENOSYS gives SI_USER with pid and uid 0. WASIX has no `ucontext_t`, so `ctx` points at 256 zero bytes.
- **`flock.c`** (new member; `<sys/file.h>` declared `flock` but libc had no definition) calls `slicc.flock(fd, op)` (slicc-kernel#893, 1.117.0): locks per open file description on any descriptor, EWOULDBLOCK for a `LOCK_NB` conflict, EINTR when a handled signal ends a wait. With `SA_RESTART` the kernel resumes the wait itself (slicc-kernel#931, 1.117.3), so there is no EINTR loop in libc. On ENOSYS (remembered), `flock` is a whole-file `fcntl` lock (`F_SETLK`/`F_SETLKW`, EACCES as EWOULDBLOCK): per process, EBADF for `LOCK_EX` on a read-only descriptor or on a pipe.
- **`poll.c`:** an entry asking for `POLLOUT` on a pipe or FIFO write end whose readers are gone reports `POLLOUT|POLLERR`, as Linux's `pipe_poll` does (#629). It reported `POLLHUP`, which is the read end's. A socket keeps `POLLHUP`. An events-0 read end gets only `POLLHUP` from a hangup, never `POLLIN`.
- **Probe `test/r33.c`** (asyncified; `R33_KERNEL=1` requires the imports, slicc-kernel ≥ 1.117.3):
  - **siginfo:** a forked child's `kill(getppid(), SIGUSR1)` through `sigwaitinfo` is SI_USER with the child's pid and our uid. Its exit through `sigtimedwait` is CLD_EXITED, status 7, with its pid. `pthread_kill` to a thread in `sigwaitinfo` is SI_TKILL with our pid.
  - **SA_SIGINFO:** a handler runs for a child's `kill` (SI_USER, the child's pid, non-NULL context) and for `raise` (our pid).
  - **flock:** on a pipe the other end conflicts, and `LOCK_UN` frees it. `LOCK_EX` on a read-only descriptor excludes another open of the file, and `LOCK_SH|LOCK_NB` there too, while a `dup` and a forked child's inherited descriptor share it. EBADF, EINVAL. With a holder in a child, a handled SIGALRM ends a blocking `LOCK_EX` with EINTR, and under `SA_RESTART` the wait goes on until the holder leaves.
  - **poll/ppoll:** `POLLOUT|POLLERR` for a write end without readers. An events-0 readable read end reports `POLLHUP` within 1 s when a forked writer exits 200 ms in (#559; -31's 50 ms re-check, now with fork as the issue asked).
  - **On a kernel without the imports:** sigwait* as -32 there, SA_SIGINFO with SI_USER and pid 0, and flock's fcntl fallback, line by line.
- **`mkfifo.c`** (new member, #878): `mkfifo`, `mkfifoat`, `mknod` and `mknodat` call `slicc_fs.path_mkfifo(dirfd, path, len, mode & 07777)` (slicc-kernel#957, 1.120.0).
  - The kernel applies the umask, answers EEXIST for any existing name (a dangling link too), and doesn't follow the last component.
  - Paths resolve against the preopens, as `chown` does.
  - `mknod` with S_IFIFO is `mkfifo`. S_IFREG (or no type) creates an empty file with `O_CREAT|O_EXCL`. S_IFCHR, S_IFBLK and S_IFSOCK give EPERM, as for an unprivileged Linux process.
  - ENOSYS (an older kernel) comes back as -1 ENOSYS.
  - `<sys/stat.h>` declares the four (wasi-libc hid them).
- **Probe `test/r34.c`** (`R34_KERNEL=1`, slicc-kernel ≥ 1.120.0): FIFO creation, the umask, EEXIST (also over a dangling link), ENOENT, `mkfifoat` with a dirfd and with AT_FDCWD, each `mknod` type, and a forked writer and a reader meeting through the FIFO. On the cert kernel: ENOSYS.
- **Not changed:** `pthread_kill` of the main thread still goes through `kill(getpid())` (the placeholder tid), so it arrives as SI_USER, not SI_TKILL.

## -35: `sigaction.c` — sa_mask and SA_NODEFER (slicc-kernel#975)

- **The gap:** `slicc.sigaction_set` carries no mask, and up to -34 `__wasm_signal` called handlers with the thread's mask unchanged. So `sa_mask` was never applied, and a handler's own signal could nest even without `SA_NODEFER`.
- **The fix:** `__wasm_signal` now blocks `sa_mask` and, unless `SA_NODEFER`, the signal itself, through `pthread_sigmask(SIG_BLOCK)` (`slicc.sigmask_set`) before it calls the handler. It restores the old mask with `SIG_SETMASK` when the handler returns.
  - A signal blocked this way stays pending, and the kernel delivers it at the restore (lowest number first).
  - With `SA_NODEFER` and an empty `sa_mask`, there's no call.
  - On a kernel without `slicc.sigmask_set`, `pthread_sigmask` only updates libc's own copy, so nothing is masked, as before.
- **Probe `test/r35.c`:**
  - **sa_mask:** a SIGUSR1 handler with SIGUSR2 in `sa_mask` raises SIGUSR2 and SIGUSR1. Neither runs inside it (depth 1); both run after it returns (order `<><>2`), and no mask is left behind.
  - **SA_NODEFER:** the nested SIGUSR1 runs at once (depth 2), while SIGUSR2 still waits.
