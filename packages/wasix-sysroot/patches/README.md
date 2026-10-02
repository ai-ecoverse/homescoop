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
