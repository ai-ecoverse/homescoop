# slicc libc shims

Vendored from the slicc wasm-realm toolchain so homescoop CI can link CLI
tools without a local slicc tree. Sync when the slicc thread sends updates
(source of truth: slicc-emscripten `slicc/lib/` / `/tmp/claude-emcc/homescoop-shims/`).

| File | Role |
| --- | --- |
| `slicc_spawn.c` | `posix_spawn` / `waitpid` / `__syscall_wait4`; file actions on fds > 2 |
| `slicc_exec.c` | `execve` over spawn (resets caught handlers; kernel forwards signals) |
| `slicc_fork.c` + `slicc-fork.js` | `fork` / `getpid` (`--js-library`, needs `-sASYNCIFY`) |
| `slicc_libc_gaps.c` | `splice` stub, sleeping `nanosleep`, `slicc_sigpipe()`, uid/gid 1000 |
| `slicc_signals.c` | `slicc_raise` / `slicc_sig_mask` / `kill` (incl. group `kill(0)` / `kill(-pgid)`) |
| `slicc_select.c` | `pselect()` / poll via the kernel (make `-jN`, curl, sockets) |
| `slicc_socket.c` | BSD sockets over `Module.sliccKernel.net` (loopback #3571); needs select |
| `slicc_jobs.c` | strong `setpgid`/`getpgid`/`setsid`/`tcgetpgrp`/`tcsetpgrp` for job control |
| `slicc_main_envp.c` | `main` that passes `environ` (`-Dmain=slicc_tool_main`) |
| `webcrypto-entropy.c` | `mbedtls_hardware_poll` via WebCrypto (Mbed TLS builds) |

## Link profiles (`homescoop_slicc_archive`)

Every profile includes `slicc_libc_gaps.c` + `slicc_signals.c`.

| Profile | Extra objects |
| --- | --- |
| `gaps` | gaps + signals — e.g. pkgconf |
| `spawn` | spawn + exec — gnu tools (updated wait4/kill from shims) |
| `make` | spawn + exec + main_envp + select + **jobs** — GNU make |
| `fork` | spawn + exec + fork + jobs + **select** — bash job control (+ ASYNCIFY js-library); select/poll required so readline does not Asyncify-suspend on poll |
| `less` | gaps + signals + jobs + select — TUI pager (no spawn) |
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
