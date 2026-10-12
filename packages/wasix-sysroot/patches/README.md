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

slicc-kernel 1.63.0 (K3(b2)) has `slicc_fs.path_access(dirfd, path, len, amode, flags)`: amode is `F_OK`/`R_OK`/`W_OK`/`X_OK`, flags 1 is no-follow and 2 is "effective ids". Under users `'enforce'` it applies Linux's permission rules (owner, group, other; search permission along the path, which `F_OK` checks too; root bypasses everything but `X_OK` on a file without any x bit). Under `'off'` and `'report'` it only resolves the path.

- **`faccessat.c` replaces cloudlibc's `faccessat.o`** (`__wasilibc_nocwd_faccessat`, which `access`, `faccessat` and the at-fdcwd paths all reach). It validates amode and flags (EINVAL), then asks `path_access`; ENOSYS (a kernel before 1.63.0) is remembered for the process, and the old check runs: `path_filestat_get` (now honouring `AT_SYMLINK_NOFOLLOW`) and the directory fd's WASI rights.
- **`AT_EACCESS` is 0x200** in `__header_fcntl.h` (Linux's value). wasi-libc defined it as 0, so it could not be told from a plain `faccessat`. Programs are linked statically against the libc from their own headers, so old binaries keep passing 0 (real ids), which is what they got before. `faccessat` also accepts `AT_SYMLINK_NOFOLLOW` now (upstream: EINVAL).
- **`eaccess`/`euidaccess`** are defined in the same object (`faccessat(AT_FDCWD, path, mode, AT_EACCESS)`) and declared in `unistd.h` under `_GNU_SOURCE` (wasi-libc hid them).
- **`at_fdcwd.c`: `linkat`** returns EINVAL for flags other than `AT_SYMLINK_FOLLOW` (0x2 in WASIX, 0x400 on Linux), as Linux does; it passed them on, and the kernel ignored them.
- **`open` rights:** cloudlibc's `openat` asks for base rights without `FD_WRITE` (and without the other write rights) for `O_RDONLY`, and slicc-kernel takes `FD_WRITE` as the write request, so no change is needed: under `'enforce'` a 0444 file opens `O_RDONLY` and is EACCES for `O_WRONLY`/`O_RDWR` (`test/r25.c`).
- **Probe:** `test/r25.c` as root (with a `seteuid(1000)` to tell `access` from `eaccess`) and as a kernel user, `R25_USERS=enforce|report|off`, and `--allow-absent` on a kernel without `path_access`.

