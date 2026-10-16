# slicc libc shims

Vendored from the slicc wasm-realm toolchain so homescoop CI can link CLI
tools without a local slicc tree. Sync when the slicc thread sends updates
(source of truth: slicc-emscripten `slicc/lib/` / `/tmp/claude-emcc/homescoop-shims/`).

| File | Role |
| --- | --- |
| `slicc_spawn.c` | `posix_spawn` / `waitpid` / `__syscall_wait4`; file actions on fds > 2 |
| `slicc_popen.c` | `system` / `popen` / `pclose` via posix_spawn (beats emscripten ENOSYS stubs) |
| `slicc-linkat.js` + `slicc_libc_gaps.c`'s `__syscall_linkat` | Hard links through slicc-kernel (slicc-kernel#563/#568). Emscripten's libc has a weak C `__syscall_linkat` stub (EMLINK) that wins over a JS-library function, so `slicc_libc_gaps.c` defines a strong one that forwards to the import `env.__syscall_linkat`. `slicc-linkat.js` (in `homescoop_em_cli_ldflags`) is that import's body: -34 (EMLINK). slicc-kernel ≥ 1.90.0 wraps the import by name (or `___syscall_linkat` in the glue) and links on its live mounts; older kernels leave the body, so `link()` is EMLINK as before. The contract: `(olddirfd, oldpath, newdirfd, newpath, flags)`, `__sig 'iipipi'`, AT_SYMLINK_FOLLOW 0x400, 0 or -errno. |
| `slicc-uname.js` + `slicc_libc_gaps.c`'s `__syscall_uname` | `uname()` through slicc-kernel (slicc-kernel#625). Emscripten's weak C `__syscall_uname` stub writes `Emscripten`/`4.0.23` from literals in the wasm, so `slicc_libc_gaps.c` defines a strong one that forwards to the import `env.__syscall_uname`. `slicc-uname.js` (in `homescoop_em_cli_ldflags`) is that import's default body: exactly what the stub filled (sysname `Emscripten`, nodename `emscripten`, release the Emscripten version, version `#1`, machine `wasm32`; domainname untouched), each field NUL-terminated within its 65 bytes, -EFAULT (-21) for a null buffer. A kernel that knows the import wraps it by name (or `___syscall_uname` in the glue) and answers `Linux`, its hostname, `6.0.0-slicc`, the `/proc/version` version, `wasm32`, `(none)`; older kernels leave the body. The contract: `(buf)`, `__sig 'ip'`, a musl `struct utsname` of 6 × 65 bytes, 0 or -errno. `test/uname.test.mjs` checks the import and the default answer. |
| `slicc_pwd.c` | `getpw*` / `getgr*` from the kernel's `/etc/passwd` and `/etc/group`. `getpwuid`/`getpwnam`/`getpwent` are strong in Emscripten's stubs, so they are `__wrap_*`, linked with `homescoop_slicc_wrap_pwd`. Every profile; manual whole-archive links without the wrap keep the stubs for those three. |
| `slicc_exec.c` | `execve`: `Module.sliccKernel.execve` keeps the caller's pid (slicc-kernel#99/#176); spawn + `execWait` on older kernels (resets caught handlers; kernel forwards signals) |
| `slicc_fork.c` + `slicc-fork.js` | `fork` / strong `getpid`/`getppid` (`--js-library`, needs `-sASYNCIFY`); adopts `Module.sliccPid` / `Module.sliccPpid` |
| `slicc_libc_gaps.c` | `splice` stub, sleeping `nanosleep`, `slicc_sigpipe()`, `sethostname` → EPERM, weak `getpid`/`getppid` from `Module.sliccPid`/`sliccPpid` (fallbacks 42/1), `__syscall_linkat`, `__syscall_uname`; it `#include`s `slicc_cred.c` unless built with `-DSLICC_CRED_SEPARATE` (the shim archives are) |
| `slicc_cred.c` | The credential library (homescoop#207, #459): `slicc_cred_js` (`Module.sliccKernel.cred()`), `slicc_cred_euid` (exported), the uid/gid getters, `getgroups`, set*id and `setgroups` through `setcred()`. Every link that uses `homescoop_em_cli_ldflags` gets it: the flags end with `-Wl,-u,slicc_cred_euid` and a plain archive of this file (`homescoop_slicc_cred_archive`, built once per `WORK`, keyed on the source, the emcc and `EM_CACHE`). slicc-kernel reads `slicc_cred_js` in the glue to decide whether a program has the credential ABI; without it, stat shows the legacy owner 1000:1000 under users mode. `scripts/check-slicc-cred.mjs` (in `host-run.sh`) refuses an Emscripten package whose command wasm lacks the import or the export, or whose glue doesn't name `slicc_cred_js`. Because `-u` is resolved after every input is read, a whole-archive shim archive anywhere on the link line is fine. A full `slicc_libc_gaps.o` (one compiled without `SLICC_CRED_SEPARATE`, as cmake, wasm-clang and wasm-emscripten do) must come before these flags when the program itself calls a set*id function, or the link has two copies. |
| `slicc_signals.c` | `slicc_raise` / `slicc_sig_mask` / `kill` (incl. group `kill(0)` / `kill(-pgid)`); `__syscall_pause` → `sliccKernel.pause` |
| `slicc_select.c` | `pselect()` / poll via the kernel (make `-jN`, curl, sockets) |
| `slicc_socket.c` | BSD sockets over `Module.sliccKernel.net` (loopback #3571); needs select. `getaddrinfo`: localhost and numeric IPv4 locally, other names via the kernel resolver `net.resolve` (slicc-kernel ≥ 1.27.0, A records only; older kernels: `EAI_NONAME`). `getnameinfo` (and musl's `gethostbyaddr` through it): `/etc/hosts` first (the kernel's names `localhost`, `::1`, its own `127.0.1.1` and `10.0.2.2 host.slicc.internal`), the rest of 127.0.0.0/8 and `::1` are `localhost`, any other address has no name (`EAI_NONAME` with `NI_NAMEREQD`, else numeric); no PTR queries; services from `/etc/services` if present, else the number (homescoop#176; `test/nameinfo.test.mjs`) |
| `slicc_jobs.c` | strong `setpgid`/`getpgid`/`setsid`/`tcgetpgrp`/`tcsetpgrp` for job control |
| `slicc_mount.c` | strong `mount` / `umount` / `umount2` over `Module.sliccKernel.mount` / `umount2` (slicc-kernel#92); ENOSYS on older kernels |
| `slicc_main_envp.c` | `main` that passes `environ` (`-Dmain=slicc_tool_main`) |
| `webcrypto-entropy.c` | `mbedtls_hardware_poll` via WebCrypto (Mbed TLS builds) |

## Link profiles (`homescoop_slicc_archive`)

Every profile includes `slicc_libc_gaps.c` (without credentials) + `slicc_pwd.c` + `slicc_signals.c`; the credentials come from `homescoop_em_cli_ldflags`.

| Profile | Extra objects |
| --- | --- |
| `gaps` | gaps + signals — e.g. pkgconf |
| `spawn` | spawn + exec + **popen** — gnu tools |
| `make` | spawn + exec + popen + main_envp + select + **jobs** — GNU make |
| `fork` | spawn + exec + popen + fork + jobs + **select** — bash (+ ASYNCIFY) |
| `mount` | gaps + signals + **mount** — mount/umount |
| `less` | gaps + signals + jobs + select — TUI pager (no spawn) |
| `cli` | spawn + exec + popen + select + jobs — coreutils/sed/gawk/tar |
| `cli` | spawn + exec + gaps + signals + select + jobs — interactive CLIs (no fork) |
| `net` | **socket** + select + spawn + exec + gaps + signals + getpass — curl / git-remote-http |
| `netfork` | net + **fork** + jobs (+ ASYNCIFY js-library) — git (clone/helpers need fork) |

Pull signal exports from the archive even when nothing in the tool references
them (the realm calls them from JS):

```bash
LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports) $WORK/libslicc.a"
```

Keep `homescoop_em_cli_ldflags` (`ENVIRONMENT=web,worker,node`, `EXIT_RUNTIME`,
`ALLOW_MEMORY_GROWTH`) on every CLI link line.

## Tests

`test/` builds small programs against the shim profiles and runs them on
slicc-kernel's headless Node entry (CI: `.github/workflows/slicc-shims.yml`):

```bash
cd shims/slicc/test && ./build.sh && npm ci && npm test
```

- `resolve.test.mjs`: getaddrinfo through the kernel resolver (homescoop#139).
- `exec.test.mjs`: exec keeps the pid (slicc-kernel#176), as a 3-level exec
  chain and fork-then-exec, built with the `cli` and `fork` profiles. It runs
  on slicc-kernel 1.26.6 (no #171 identity wait, so only the shim can make it
  pass) and on the current kernel. With `slicc_exec.c` from before #75
  (spawn + `execWait` only), all six cases fail: `L3 1000`, `L2 1001`,
  `L1 1002`, `L0 1003`.

- `pwd.test.mjs`: getpwuid / getpwnam / the `_r` forms (ERANGE on a short
  buffer) / getpwent / getgrgid / getgrnam read the kernel's `/etc/passwd`
  and `/etc/group` (screen: "getpwuid() can't identify your account!").
  `pwd-test` calls `flock()`, which pulls Emscripten's stubs object into
  the link. Without `--wrap`, plain definitions fail to link (`duplicate
  symbol: getpwnam`, `getpwuid`, `getpwent`), and linking the archive
  without the wrap flags leaves those three on the stubs (`uid none`).
