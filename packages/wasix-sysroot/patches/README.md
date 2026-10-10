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
