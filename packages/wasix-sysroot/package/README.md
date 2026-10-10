# @ai-ecoverse/wasix-sysroot

WASIX libc/libcxx/compiler-rt sysroots, laid out as a wasixcc `SYSROOT_PREFIX`:

- `sysroot` — no wasm exceptions (asyncify path)
- `sysroot-eh` / `sysroot-ehpic` — legacy EH, static / PIC
- `sysroot-exnref-eh` / `sysroot-exnref-ehpic` — exnref EH, static / PIC

Each tree has a real `lib/wasm32-wasip1` (not a symlink — npm/ipk skip
links). clang 24 `--target=wasm32-wasip1` resolves crt/libc there.
`unistd.h` declares `fork` under `__wasix__` even with `-fwasm-exceptions`.
EH `libc.a` archives get real `fork`/`_Fork` from asyncify (static trees).
Every libc embeds SLICC identity stubs (getuid=1000) and reports
`st_uid`/`st_gid` 1000 from `stat`/`lstat`/`fstat`/`fstatat`.
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

Since 2025.9.30-20 user and group ids come from slicc-kernel's process
credentials (`slicc.cred_get`/`cred_set`/`groups_get`/`groups_set`; slicc-kernel
≥ 1.44.0, which has users), and `getpw*`/`getgr*` read its `/etc/passwd` and `/etc/group`.
There is no fallback to uid 1000: on an older kernel `getuid()` returns -1,
the set\*id calls fail with ENOSYS, and user lookups find nothing.

Data only — no commands. Set `WASIXCC_SYSROOT_PREFIX` to this package directory.
