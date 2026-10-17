# Negative proof (wasix-sysroot)

## 2025.9.30-33: no flock, SA_SIGINFO handlers never run, no sender in siginfo_t, POLLHUP on a write end (-34)

On slicc-kernel 1.117.3's Node entry (2026-10-17):
- **flock:** `test/r33.c` doesn't link against -33 (`run-modes.mjs --probe r33 --tarball <-33>`): `wasm-ld: error: … undefined symbol: flock`. `<sys/file.h>` declares it, but libc defines nothing.
- **SA_SIGINFO:** a program that installs an `SA_SIGINFO` handler for SIGHUP and calls `raise(SIGHUP)` prints `got=0` on -33 and on -32: the handler never runs. -34 runs it (r33: `signo=1 code=SI_USER pid=sender`).
- **The sender:** -33's `sigwaitinfo` reports a forked child's `kill` as `si_pid` 0 (homescoop#770). -34 gives the child's pid.
- **poll:** for a pipe write end whose reader has closed, `poll(POLLOUT)` returns `revents=POLLHUP` on -33 (#629). -34 returns `POLLOUT|POLLERR`.
- **mkfifo (#878):** -33's libc has no `mkfifo`, `mkfifoat`, `mknod` or `mknodat`, and `<sys/stat.h>` hides them (`WASI has no fifo`), so `test/r34.c` doesn't compile against -33. On 1.120.0, -34 makes the FIFO.

## 2025.9.30-32: unverifiable root, no __cxa_thread_atexit (-33, homescoop#890, #864)

**Supply chain.** -32's `recipe.yaml` `source.url` is our own npm `@ai-ecoverse/wasix-sysroot@2025.9.30-14`, a local build. Every libc, libc++, compiler-rt, crt object and header in -15…-32 comes from it, and nothing records how it was made. The cert lane marks -29…-32 FAIL ("unverifiable input"). -33's only inputs are public, sha256-pinned tarballs:
- wasix-libc v2026-07-03.1;
- llvm-project 6bb93a24;
- wasix-org's LLVM 21.1.206 release.

They are built by `build-source.sh` + `build-incremental.sh` in ladder-pr.

The comparison also corrects the record about -14: it wasn't wasix-libc v2025-09-02.1, the tag this recipe named. Its libc defines `__wasi_context_*`, `__wasi_proc_spawn3`, `proc_exec4`, `proc_fork_env` and `proc_exit2`, which first appear in v2026-06-25.1/v2026-07-03.1, and it lacks v2025-09-02.1's `__wasilibc_exec_combine_strings`.

**Behaviour.** `test/cxx-eh.mjs` (four EH trees × wasm-clang 24 and wasixcc clang 21, C++ exceptions and std::terminate) with npm's -32 as `--sysroot`, against wasm-clang 24.0.0-21 on slicc-kernel 1.100.0's Node entry (2026-10-17), fails at the link: `wasm-ld: error: … undefined symbol: __cxa_thread_atexit`, from the `thread_local std::string`. -32's libc++abi has no `__cxa_thread_atexit` (#211). -33 passes all 8 builds (`caught=117107 dtors=2 tl=tls seen=in thread`, and the terminate handler). Without `eh-compat/gxx_wasm_personality.c`, -33 fails the same spec with `undefined symbol: __gxx_wasm_personality_v0`. LLVM 24 codegen calls that personality, and LLVM 20's libunwind names it `_Unwind_CallPersonality`.

## 2025.9.30-31: no kernel sigwait, inherited ignores read as SIG_DFL (-32, homescoop#520, #740, #466)

`run-modes.mjs --tarball ai-ecoverse-wasix-sysroot-2025.9.30-31.tgz --probe r32 --kernel @ai-ecoverse/slicc-kernel@1.108.1`, default variant, 2026-10-16: FAIL. The kernel has all three imports (the probe calls them itself), but -31's libc doesn't use them. Every sigwait line is ENOSYS:

```text
sigwait: Function not implemented sig=-7 handler=0
sigwaitinfo: -1 Function not implemented signo=0 code=? handler=0
sigtimedwait 200ms: -1 Function not implemented early
sigtimedwait 0: -1 Function not implemented fast
sigtimedwait bad: -1 Function not implemented
sigtimedwait through a handled alarm: -1 Function not implemented alarm=0 early
sigwaitinfo from another thread's kill: -1 Function not implemented off handler=0
```

-32 passes r32 in all five variants on 1.108.1, and its fallback branch on 1.100.1.

`SA_NOCLDWAIT` already reaches the kernel on -31 (its `sigaction_set` passes `sa_flags` raw), so that line is the kernel's, not a -32 change. The epoll_pwait race loop (200 rounds) didn't hit the swap window on -31 either, in this run. The atomic wait is the kernel's #783 and is covered by its own integration tests. Here, `build-incremental.sh` checks that every libc.a references `slicc.sigmask_epoll_wait`, and r32 checks the result.

## 2025.9.30-30: AF_UNIX addresses, events-0 hangup (-31, homescoop#515, #464)

`run-modes.mjs --tarball ai-ecoverse-wasix-sysroot-2025.9.30-30.tgz --probe r31` on slicc-kernel 1.100.1 (2026-10-16): FAIL.
- `bind(…, sizeof(struct sockaddr_un))` gives `-1 Success`: `sockaddr_to_wasi` refused the 108-byte path area and returned -1, which became errno.
- A python program that binds with the exact length (thr_yix6z44j96's repro, wasix-python 3.14.2-21) gets `(0, b'')` from `getsockname`, from `accept`'s peer and from the client's `getpeername`, so `multiprocessing.Manager()` fails (#515).
- `poll`/`ppoll` with an events-0 entry on a pipe whose writer closed give `0 revents=0` after the full 2 s (`slow`), and the write end of a pipe whose reader is gone reports nothing.

-31 passes every r31 line in all five variants.

## 2025.9.30-29: no POSIX record locks in the headers or libc (-30, homescoop#407)

`run-modes.mjs --tarball ai-ecoverse-wasix-sysroot-2025.9.30-29.tgz --probe r30lock`, 2026-10-16: the probe doesn't build (`F_SETLK`, `F_GETLK`, `F_SETLKW`, `F_RDLCK`/`F_WRLCK`/`F_UNLCK` undeclared, `lockf` undeclared and not in libc.a). Programs carried their own numbers and no-op stubs (wasix-python's `fcntl_wasix_extra.h` uses 7/8/9 with `--wrap=fcntl`), so no lock ever reached the kernel, and python's sqlite could write through another process's lock (homescoop#407).

## 2025.9.30-29: no named semaphores between processes (-30, homescoop#486)

`run-modes.mjs --tarball ai-ecoverse-wasix-sysroot-2025.9.30-29.tgz --probe r30` with `R30_SEM=1` on slicc-kernel 1.99.0, which has `slicc.sem_*` (2026-10-16): FAIL with `R30_SEM=1 but sem_open: No such file or directory`. -29's musl `sem_open` creates `/dev/shm/sem.r30a`, which this kernel doesn't keep (slicc-kernel#716). Even with a working `/dev/shm`, the `MAP_SHARED` page it maps wouldn't be shared with a forked or spawned process. -30 passes every r30 line in all five variants.

## 2025.9.30-28: poll/ppoll refuse events 0, epoll_ctl misnumbers its ops (-29, homescoop#394, #443)

`run-modes.mjs --tarball ai-ecoverse-wasix-sysroot-2025.9.30-28.tgz --probe r29 --kernel-dir <slicc-kernel 1.97.0>`, default variant, 2026-10-16: FAIL. Every poll/ppoll case is ENOSYS; `epoll_create1` drops `EPOLL_CLOEXEC`; a second ADD "succeeds" (it arrives as WASIX op 1, which the kernel takes as add-or-modify); errors come back as positive values (44 ENOENT, 28 EINVAL) instead of -1; `data.u64` 0x100000000 comes back as the fd (14) with garbage above; `epoll_wait` stops at 64; `epoll_pwait` ignores its mask and sleeps its 3 s:

```text
poll mixed: -1 Function not implemented revents=0,0,0,0
poll none: -1 Function not implemented revents=0,0 wrong
poll nval: -1 Function not implemented nval=0 revents=0 fast
poll other bits: -1 Function not implemented revents=0
ppoll mixed: -1 Function not implemented revents=0,0,0,0
(ppoll none, nval, other bits: the same)
epoll: yes cloexec=0
ctl add: 0
ctl add again: 0
wait: 1 events=1 data=ffffffff0000000e
ctl mod: 0
wait mod: 1 data=ffffffff0000000e
ctl del: 0
ctl del again: 44
ctl bad op: 28
ctl not epoll: 28
many: 64 distinct=64
pwait: 0 handler=0 slow blocked=1
```

The same probe's signal lines on -29 against slicc-kernel 1.92.0 (before slicc-kernel#596) show what the 1.93.0 cases catch: `rt thread=0`, `rt child=0`, `rt exec=0` (signal 40's mask bit lost), and `r29 bothterm` exits 143 without bash's "Terminated".

## Known kernel limit, not a -28 regression: the window (slicc-kernel#561)

r28w's two "window" lines: a child sends SIGUSR1 while the parent busy-loops 400 ms without kernel calls, then the parent waits in `pselect` on an idle pipe for 10 s. On slicc-kernel 1.77.0, 1.88.0 and #551 @2937137 the handler runs at the start of that call (0.00 s) and the wait still sleeps 10 s: `window: arrived_before_wait handler=0; pselect 0 handler=1 slow`, the same with a mask. It's the kernel's, it affects -27 equally (-27 exposes every signal that arrives during computation, the -28 fallback only the instructions between its `sigmask_set` and `poll_oneoff`), and slicc-kernel#567 fixes it: on c0869d4 both lines are `pselect -1 EINTR handler=1 fast`, which `R28_WINDOW=1` asserts. slicc-kernel 1.91.0 ships #567; the -28 cert runs on it with `R28_WINDOW=1` (both lines `pselect -1 EINTR handler=1 fast` in all five variants, 2026-10-15).

## Fallback check: -27 and -28 with neither import (slicc-kernel 1.77.0), 2026-10-14

r28w without its ppoll and sigwait cases, on the published -27 and on -28 (a674b53d…). The gpg-agent pattern gives the same result on both kernels' worth of libc; -28 only adds a working sigsuspend and a mask that reads back:

```text
-27: pselect pending: 0 handler=1 slow still_blocked=0     -28: … still_blocked=1
-27: sigsuspend: 28 handler=0 fast still_blocked=0         -28: sigsuspend: -1 EINTR handler=1 fast still_blocked=1
both: agent HUP: -1 EINTR handler=1 fast
both: agent TERM: -1 EINTR handler=1 fast
both: agent rounds: 8/8
```

## -28 at 2f4352f7 (masks, no masked wait): blocked signals are stranded (r28w)

`r28w` without its `ppoll` case, against the libc of homescoop#317 at 2f4352f7 (masks through `slicc.sigmask_set`, `pselect` ignoring its mask) on slicc-kernel `fix/wasix-sigmask` 8b52a64, 2026-10-14. gpg-agent's pattern never sees HUP or TERM (its 10 s wait times out, handler not run); `sigsuspend` returns the value EINVAL; `sigwait` "succeeds" with signal 9:

```text
pselect pending: 0 handler=0 slow still_blocked=1
sigsuspend: 28 handler=0 fast still_blocked=1
agent HUP: 0 handler=0 slow
agent TERM: 0 handler=0 slow
sigtimedwait: 28
sigwaitinfo: 28
sigwait: Success sig=9
```

## 2025.9.30-27: sigprocmask keeps no mask, sigpending fails (-28, slicc-kernel #460)

`run-modes.mjs --tarball ai-ecoverse-wasix-sysroot-2025.9.30-27.tgz --probe r28 --kernel-dir <slicc-kernel 1.77.0>`, 2026-10-14: FAIL. WASIX's `pthread_sigmask` returned 0 without storing the mask or writing `*old`; `sigpending` returned EINVAL as its result (not -1 with errno), and the bad-`how` check was missing:

```text
start: mask=- pending=-1 Success
blocked: usr1=1 pending=-1 Success mask=-
kill/stop: mask=-
old: - now=-
bad how: Success
child: mask=-
```

## 2025.9.30-26: utimensat(NULL) sets the times to 1970; CPU times are the wall clock (-27, homescoop#294)

`run-modes.mjs --tarball ai-ecoverse-wasix-sysroot-2025.9.30-26.tgz --probe r27 --kernel-dir <slicc-kernel 1.71.1>`, 2026-10-13: FAIL.

```text
+   'utimensat NULL: r=0 errno=0 mtime=other',          (0: 1970)
+   'utimensat NOW,NOW: r=-1 errno=Success mtime=kept',
+   'utimensat 5,OMIT: r=-1 errno=Success mtime=kept',
+   'futimens OMIT,NOW: r=-1 errno=EINVAL mtime=kept',
+   'utimes NULL: r=0 errno=0 mtime=other',
```

wasix-python 3.14.2-16: `os.utime(p)` and `pathlib.Path(p).touch()` leave mtime 0. xcuw's C probe on -26: `times=1791890215325000000 utime=325000 stime=1791890215 cutime=325000 cstime=1791890215`, `getrusage utime=1791890215.326704334000 stime=1791890215.326704334000`.


## 2025.9.30-25: an empty path is the current directory (-26, homescoop#281)

`run-modes.mjs --tarball ai-ecoverse-wasix-sysroot-2025.9.30-25.tgz --probe r26 --kernel-dir <slicc-kernel 1.71.1>`, 2026-10-13: FAIL. The kernel's `*at(dirfd, "")` are already ENOENT, but libc turns `""` into the cwd first:

```text
+   'open: 0',
+   'stat: 0',
+   'access: 0',
+   'mkdir: EEXIST',
+   'unlink: EISDIR',
+   'chmod: 0',
+   'opendir: 0',
+   'fstatat AT_EMPTY_PATH: ENOENT same=0',
```

-26 on slicc-kernel 1.69.0 (before #404) fails only the dirfd forms (`fstatat dirfd: 0`, `openat dirfd: 0`, `mkdirat dirfd: EEXIST`): those are the kernel's.

## 2025.9.30-24: access() says yes where open() says no (-25, slicc-kernel K3(b))

`R25_USERS=enforce run-modes.mjs --tarball ai-ecoverse-wasix-sysroot-2025.9.30-24.tgz --probe r25 --kernel-dir <slicc-kernel 1.63.0>`, 2026-10-11: FAIL. As user cone, `access(priv, R_OK)` is 0 while `open(priv, O_RDONLY)` is EACCES; `ro W`, `rw W`, `ro X` and `dirfd priv R` are all 0; `eaccess` does not exist; `AT_EACCESS` is 0, so root after `seteuid(1000)` gets 0 for the effective check; `faccessat(AT_SYMLINK_NOFOLLOW)` is EINVAL; and `linkat` passes flags 0x1 and 0x400 to the kernel (EPERM on the root file system) instead of EINVAL:

```text
cone: ro W: 0   rw W: 0   ro X: 0   priv R: 0   dirfd priv R: 0   link follow R: 0
cone: eaccess priv R: missing   link nofollow R: EINVAL   open priv RDONLY: EACCES
root: effective priv R: missing   effective at priv R: 0   linkat flag 0x400: EPERM
```

## 2025.9.30-23: `linkat` with `AT_FDCWD` on both sides is ENOENT (-24)

`run-modes.mjs --tarball ai-ecoverse-wasix-sysroot-2025.9.30-23.tgz --probe r24link --kernel-dir <slicc-kernel 1.59.0>`, default and `--variant ehpic`, 2026-10-11: both FAIL. On a tmpfs mount `link()` and `linkat` with a directory fd work, but every `linkat(AT_FDCWD, …, AT_FDCWD, …)` hands the kernel the new path as the old one:

```text
+   'linkat cwd rel: -1 ENOENT',
-   'linkat cwd rel: 0 file same=1',
+   'linkat cwd abs: -1 ENOENT',
-   'linkat cwd abs: 0 file same=1',
+   'linkat follow: -1 ENOENT',
-   'linkat follow: 0 file same=1',
+   'nlink=4',
-   'nlink=7',
```

## 2025.9.30-23: chown is ENOSYS and stat shows the caller (-24, slicc-kernel K3)

`R24_USERS=enforce run-modes.mjs --tarball ai-ecoverse-wasix-sysroot-2025.9.30-23.tgz --probe r24 --kernel-dir <slicc-kernel feat/users-k3a-drivers 5600e81>`, default and `--variant ehpic`, 2026-10-11: both FAIL. The kernel keeps owners, but -23 never asks for them: chown to a real id is upstream's ENOSYS, a bad `fchownat` flag is accepted, and stat shows root's own 0:0:

```text
+   'chown: -1 ENOSYS owner=0:0',
-   'chown: 0 owner=1000:1000',
+   'fchown: 0 owner=0:0',
-   'fchown: 0 owner=0:1000',
+   'fchownat badflag: 0',
-   'fchownat badflag: -1 EINVAL',
+   'missing: -1 ENOSYS',
-   'missing: -1 ENOENT',
```

## 2025.9.30-22: Linux window-size ioctl numbers are EINVAL (-23, homescoop#250)

`run-modes.mjs --tarball ai-ecoverse-wasix-sysroot-2025.9.30-22.tgz --probe r23` (sha256 806fbe66…), default and `--variant ehpic`, slicc-kernel 1.48.0 Node entry, 2026-10-11: both FAIL. WASIX's 0x101/0x102 answer per fd; Linux's 0x5413/0x5414 fall through to `ioctl`'s default branch everywhere:

```text
+   'tty linux: get=EINVAL 0x0 set=EINVAL',
-   'tty linux: get=ok 100x30 set=ok',
+   'stdin pipe linux: get=EINVAL 0x0 set=EINVAL',
-   'stdin pipe linux: get=ENOTTY 0x0 set=ENOTTY',
+   'file linux: get=EINVAL 0x0 set=EINVAL',
-   'file linux: get=ENOTTY 0x0 set=ENOTTY',
+   'closed linux: get=EINVAL 0x0 set=EINVAL',
-   'closed linux: get=EBADF 0x0 set=EBADF',
```

## 2025.9.30-22: no fork in the PIC variants (-23, homescoop#253)

`run-modes.mjs --tarball ai-ecoverse-wasix-sysroot-2025.9.30-22.tgz --probe r23fork --variant ehpic`, 2026-10-11: the probe does not link.

```text
wasm-ld: error: …/r23fork.c.0.o: undefined symbol: fork
wasm-ld: error: …/r23fork.c.0.o: undefined symbol: _Fork
```

`llvm-nm --defined-only` on -22's `sysroot-ehpic` and `sysroot-exnref-ehpic` `libc.a`: `fork.o` and `_Fork.o` are empty. The default variant (`sysroot-exnref-eh`, static) passes on -22 too: it has had fork since -14.

## 2025.9.30-21: no libc generation marker, exported itimer helper (-22)

`run-modes.mjs --tarball ai-ecoverse-wasix-sysroot-2025.9.30-21.tgz --probe r22`, default and `--variant ehpic`, 2026-10-11: both FAIL with `slicc.libc custom section: undefined`. Nothing in a -21 (or older) program tells the kernel which libc it has. And wasix-python 3.14.2-15, a dynamic-main on -21, exports `__homescoop_itimer_real_left` (next to `getitimer`, `setitimer`).

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

