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

Since 2025.9.30-21 terminals are per descriptor (slicc-kernel's `slicc_tty`,
slicc-kernel#289):
- `tcgetattr`/`tcsetattr` carry the whole termios, so `cfmakeraw` is really
  raw;
- `ioctl(TIOCGWINSZ)`, `TCGETS`/`TCSETS*` and `isatty` answer for that fd
  (ENOTTY on pipes and files);
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
