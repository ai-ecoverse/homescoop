# slicc libc shims

Vendored from the slicc wasm-realm toolchain so homescoop CI can link CLI
tools without a local slicc tree. Sync when the slicc thread sends updates
(source of truth: slicc-emscripten `slicc/lib/` / `/tmp/claude-emcc/homescoop-shims/`).

| File | Role |
| --- | --- |
| `slicc_spawn.c` | `posix_spawn` / `waitpid` / `__syscall_wait4`; file actions on fds > 2 |
| `slicc_popen.c` | `system` / `popen` / `pclose` via posix_spawn (beats emscripten ENOSYS stubs) |
| `slicc_pwd.c` | `getpw*` / `getgr*` from the kernel's `/etc/passwd` and `/etc/group`. `getpwuid`/`getpwnam`/`getpwent` are strong in Emscripten's stubs, so they are `__wrap_*`, linked with `homescoop_slicc_wrap_pwd`. Every profile; manual whole-archive links without the wrap keep the stubs for those three. |
| `slicc_exec.c` | `execve` over spawn (resets caught handlers; kernel forwards signals) |
| `slicc_fork.c` + `slicc-fork.js` | `fork` / strong `getpid`/`getppid` (`--js-library`, needs `-sASYNCIFY`); adopts `Module.sliccPid` / `Module.sliccPpid` |
| `slicc_libc_gaps.c` | `splice` stub, sleeping `nanosleep`, `slicc_sigpipe()`, uid/gid getters→1000, set*id/setgroups accept only 1000, `sethostname` → EPERM, weak `getpid`/`getppid` from `Module.sliccPid`/`sliccPpid` (fallbacks 42/1) |
| `slicc_signals.c` | `slicc_raise` / `slicc_sig_mask` / `kill` (incl. group `kill(0)` / `kill(-pgid)`); `__syscall_pause` → `sliccKernel.pause` |
| `slicc_select.c` | `pselect()` / poll via the kernel (make `-jN`, curl, sockets) |
| `slicc_socket.c` | BSD sockets over `Module.sliccKernel.net` (loopback #3571); needs select. `getaddrinfo`: localhost and numeric IPv4 locally, other names via the kernel resolver `net.resolve` (slicc-kernel ≥ 1.27.0, A records only; older kernels: `EAI_NONAME`) |
| `slicc_jobs.c` | strong `setpgid`/`getpgid`/`setsid`/`tcgetpgrp`/`tcsetpgrp` for job control |
| `slicc_mount.c` | strong `mount` / `umount` / `umount2` over `Module.sliccKernel.mount` / `umount2` (slicc-kernel#92); ENOSYS on older kernels |
| `slicc_main_envp.c` | `main` that passes `environ` (`-Dmain=slicc_tool_main`) |
| `webcrypto-entropy.c` | `mbedtls_hardware_poll` via WebCrypto (Mbed TLS builds) |

## Link profiles (`homescoop_slicc_archive`)

Every profile includes `slicc_libc_gaps.c` + `slicc_signals.c`.

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

- `pwd.test.mjs`: getpwuid / getpwnam / the `_r` forms (ERANGE on a short
  buffer) / getpwent / getgrgid / getgrnam read the kernel's `/etc/passwd`
  and `/etc/group` (screen: "getpwuid() can't identify your account!").
  `pwd-test` calls `flock()`, which pulls Emscripten's stubs object into
  the link. Without `--wrap`, plain definitions fail to link (`duplicate
  symbol: getpwnam`, `getpwuid`, `getpwent`), and linking the archive
  without the wrap flags leaves those three on the stubs (`uid none`).
