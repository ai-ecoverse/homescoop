# slicc libc shims

Vendored from the slicc wasm-realm toolchain so homescoop CI can link CLI
tools without a local slicc tree. Sync when the slicc thread sends updates
(source of truth: slicc-emscripten `slicc/lib/` / `/tmp/claude-emcc/homescoop-shims/`).

| File | Role |
| --- | --- |
| `slicc_spawn.c` | `posix_spawn` / `waitpid` / `__syscall_wait4` (WUNTRACED/WCONTINUED) |
| `slicc_exec.c` | `execve` over spawn (resets caught handlers; kernel forwards signals) |
| `slicc_fork.c` + `slicc-fork.js` | `fork` / `getpid` (`--js-library`, needs `-sASYNCIFY`) |
| `slicc_libc_gaps.c` | `splice` stub, sleeping `nanosleep`, `slicc_sigpipe()` |
| `slicc_signals.c` | `slicc_raise` / `slicc_sig_mask` / `kill` (incl. group `kill(0)` / `kill(-pgid)`) |
| `slicc_select.c` | `pselect()` via the kernel (make `-jN` jobserver) |
| `slicc_jobs.c` | strong `setpgid`/`getpgid`/`setsid`/`tcgetpgrp`/`tcsetpgrp` for job control |
| `slicc_main_envp.c` | `main` that passes `environ` (`-Dmain=slicc_tool_main`) |

## Link profiles (`homescoop_slicc_archive`)

Every profile includes `slicc_libc_gaps.c` + `slicc_signals.c`.

| Profile | Extra objects |
| --- | --- |
| `gaps` | gaps + signals — e.g. pkgconf |
| `spawn` | spawn + exec — gnu tools (updated wait4/kill from shims) |
| `make` | spawn + exec + main_envp + select + **jobs** — GNU make |
| `fork` | spawn + exec + fork + **jobs** — bash job control (+ ASYNCIFY js-library) |

Pull signal exports from the archive even when nothing in the tool references
them (the realm calls them from JS):

```bash
LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports) $WORK/libslicc.a"
```

Keep `homescoop_em_cli_ldflags` (`ENVIRONMENT=web,worker,node`, `EXIT_RUNTIME`,
`ALLOW_MEMORY_GROWTH`) on every CLI link line.
