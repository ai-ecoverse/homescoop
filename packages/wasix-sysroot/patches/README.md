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

## -18: `pselect.c`, `chdir.c`, `__tz.c`, `socketpair.c`

All from wasix-libc tag `v2025-09-02.1`. `build-incremental.sh` replaces `pselect.o`, `chdir.o`, `__tz.o` and `socketpair.o` in every `libc.a`, after checking that each patched object defines every symbol the shipped one did.

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

