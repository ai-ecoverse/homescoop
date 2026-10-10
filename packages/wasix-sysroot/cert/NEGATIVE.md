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

## 2025.9.30-18 (`run-modes.mjs --probe r18`), slicc-kernel 1.42.0 Node entry

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

