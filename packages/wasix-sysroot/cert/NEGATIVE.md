# Negative proof (wasix-sysroot 2025.9.30-17)

**Date:** 2026-10-10

`node packages/wasix-sysroot/test/run-modes.mjs --tarball <2025.9.30-16 package.tgz>`
(cert/meta.json `"slicc_fs": true`).

## Kernel without slicc_fs (1.34.1)

The imports answer ENOSYS, so the strict run fails at once:

```text
FAIL test/modes.mjs
AssertionError [ERR_ASSERTION]: the kernel has no slicc_fs imports:
slicc_fs absent
```

The same program still exits 0 there with upstream behaviour: modes
unchanged, `stat` mode bits 000, `chmod` a no-op.

## libc umask probe returning 0

An earlier draft of `patches/posix.c` restored the umask into the variable
it returned, so every fresh create used umask 0. On a slicc_fs kernel
(slicc-kernel main 01ffe70, the code released as 1.35.1):

```text
-   grp: '640',      +   grp: '666',
-   sub: '755',      +   sub: '777',
```

## Create cost of -16

-16 made every `open(O_CREAT)` ask the kernel four extra times (an
`fstatat` to see whether the file was fresh, a `umask(0)`/`umask(old)`
pair, `fd_chmod`). Its cert measured +53% on 1.35.1 (332 → 508 ms per
2000 creates) and +36% on 1.34.1. -17 caches the umask, uses `O_EXCL` to
detect a fresh create, and skips the chmod when the kernel's own create
mode is already right. `test/run-bench.mjs`, 10 interleaved rounds × 2000,
medians against the published -15:

| case | 1.35.1 -15 | 1.35.1 -17 | 1.34.1 -15 | 1.34.1 -17 |
| --- | --- | --- | --- | --- |
| fresh 0644 | 304.1 | 305.1 (+0.3%) | 296.1 | 299.3 (+1.1%) |
| fresh 0600 | 289.4 | 322.4 (+11.4%) | 291.8 | 280.4 (−3.9%) |
| existing 0600 | 189.6 | 218.1 (+15.1%) | 195.1 | 198.7 (+1.8%) |
| mkdir 0700 | 164.8 | 213.8 (+29.7%) | 160.9 | 159.4 (−0.9%) |

## 2025.9.30-18 (`run-modes.mjs --probe r18`), slicc-kernel 1.41.3 and 1.42.0 Node entry

The published 2025.9.30-17 under `timeout 20`: ENOSYS (52) for every select with exceptfds and for the sub-second select (no wait), a lexical cwd after `chdir("..")` from the symlink, UTC for every TZ, and then a hang in `socketpair(SOCK_STREAM|SOCK_NONBLOCK|SOCK_CLOEXEC)` (killed at 20 s, rc 124):

```
select data: n=-1 r=0 e=0 errno=52
select empty: n=-1 errno=52 waited=no
pselect except only: n=-1 e=0 errno=52 waited=no
chdir ln/..: rc=0,0 cwd=r18/q f=No such file or directory deep=0
tz UTC 2026-01: gmtoff=0 isdst=0 12:00 UTC mktime=ok
tz EST5EDT,M3.2.0,M11.1.0 2026-01: gmtoff=0 isdst=0 12:00 UTC mktime=ok
tz EST5EDT,M3.2.0,M11.1.0 2026-07: gmtoff=0 isdst=0 12:00 UTC mktime=ok
tz CET-1CEST,M3.5.0,M10.5.0/3 2026-07: gmtoff=0 isdst=0 12:00 UTC mktime=ok
tz <+0530>-5:30 2026-03: gmtoff=0 isdst=0 12:00 UTC mktime=ok
```

On slicc-kernel 1.35.1, -18 passes everything but socketpair (that kernel has no `sock_pair`: ENOSYS).

The sigaction lines, with `sockets()` skipped so -17 gets past the hang (1.41.3): `SA_RESETHAND` is ignored, so the handler is still installed after it runs.

```
sigaction resethand: hits=1 reset=0
sigaction ignore: survived
sigaction kill handler: hits=1
```

## 2025.9.30-19 (`run-modes.mjs --probe r19`), slicc-kernel 1.41.3 Node entry

The published 2025.9.30-18. The probe builds with wasixcc's default variant.

```text
raise: rc=71 hits=0
pthread_kill self: rc=71 hits=0
setitimer virtual/prof: 0 Success 0 Success vtalrm=0 prof=0 alrm=0
getitimer: rc=28 left=off old=off after-cancel=0
alarm returns: 0 0
alarm 1: fired=off count=0
setitimer 200+100ms: ticks=3..6 after-cancel=0
nanosleep timer: rc=0 errno=Success rem=off alrm=0
```

- **`raise` / `pthread_kill(pthread_self())`:** use `thread_signal` with a tid the kernel does not deliver to, and return its WASI errno as the result.
- **`setitimer(ITIMER_VIRTUAL/PROF)`:** "succeeds". On the variants with wasix-python's patch it armed a wall-clock SIGALRM, which the first -19 build did too (the cert's gate).
- **`getitimer`:** returns EINVAL (28) as a value.
- **`alarm(1)`:** has interval 0, which cancels the timer.
- **`nanosleep`:** the same one-shot timer never fires, so the sleep runs out and reports success.
- **`kill -USR1` from bash:** a `nanosleep` it cut short also reported success (rc 0, slept 514 ms of 3 s), and an interrupted `sleep(3)` returned 3.

-19 passes r19 on 1.35.1, 1.41.3 and 1.42.2. With `R19_SIGSTATE=1` it also passes on slicc-kernel#260 (9ae912a), where `/proc/<pid>/status` of `r19 hold` shows `SigIgn: 0000000000000806` (INT and QUIT from bash's background job, plus USR2) and `SigCgt: 0000000000006200` (USR1, ALRM, TERM).

-19's second build (690c496b) zeroed `*rmtp` before reading `*rqtp` on the EINTR path, which the PIC variants take. With `rqtp == rmtp` (`sleep()`, `nanosleep(&ts, &ts)`):
- `sleep(3)` interrupted at 0.5 s returned 0;
- an aliased 2 s nanosleep kept rem 0;
- the EINTR retry loop for 1 s ended after 201 ms.

The `nanosleep aliased` and `nanosleep loop 1s` lines and `--variant ehpic` cover it. On -18, `--variant ehpic` differs from the default (its libc had wasix-python's alarm patch): `alarm 1: fired=off count=2`.


## 2025.9.30-20 (`run-modes.mjs --probe r20`), slicc-kernel 1.44.0 (K1)

- **-18 and -19 don't compile the probe.** Their `unistd.h` hides `getresuid`, `getresgid`, `getgroups` and `setresuid`, and every process is uid 1000 `user` with home `/home/user`, root or not.
- **-20 on slicc-kernel 1.42.2 (no K1)** shows the documented failure, with no fallback:

```text
ids: uid=-1 euid=-1 gid=-1 egid=-1 res=-1:-1/…
groups: n=-1 m=-1 small=-2 errno=0
pwuid: - - -
grgid: -
pwnam root: uid=-1 dir=-
user setuid0: -1 errno=Function not implemented
user setgroups: -1 errno=Function not implemented
```

## 2025.9.30-20 `%Z` (`run-modes.mjs --probe tzname`), slicc-kernel 1.44.0

The published 2025.9.30-19. Every `tm_zone` that is not one of musl's own pointers printed `""`:

```text
+   'copy EST: []',
+   'copy EDT: []',
+   'copy UTC: []',
+   'tzif jan copy: []',
+   'tzif jul copy: []',
```

That is what CPython's `time.strftime('%Z', time.localtime())` returned on wasix-python 3.14.2-13 CI round 2.

## 2025.9.30-21 (`run-modes.mjs --probe r21`), slicc-kernel#289 (`fix/wasix-termios` d4be71a)

The published 2025.9.30-20 on the same kernel. `cfmakeraw` stays half raw: ISIG and IEXTEN on, `VMIN` 0, OPOST already off in cooked mode. ^C raises SIGINT, and the read fails:

```text
+   'cooked: ICANON=1 ECHO=1 ISIG=1 OPOST=0',
+   'raw: set=ok ICANON=0 ECHO=0 ISIG=1 IEXTEN=1 OPOST=0 ICRNL=0 VMIN=0',
+   'read: n=-1,1 bytes=0,113 sigints=1',
+   'restored: ICANON=1 ECHO=1 ISIG=1 OPOST=0',
```

On older kernels `TIOCGWINSZ` on a pipe or a file also answered 80x24 (#279; that kernel half is in #289).

### -21 file types (`--probe fifo`), slicc-kernel #307 (`fix/pipe-fifo` cd2da91)

The published 2025.9.30-20 on #307. -20 dropped `fd_mode`'s type bits and kept only the permissions, so a pipe stays typeless:

```text
+   'stdin pipe: fifo=0 sock=0 reg=0 dir=0 lnk=0 chr=0 fmt=0',
+   'pipe(): fifo=0 sock=0 reg=0 dir=0 lnk=0 chr=0 fmt=0'
```

