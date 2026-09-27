# slicc libc shims

Vendored from the slicc wasm-realm toolchain so homescoop CI can link CLI
tools without a local slicc tree. Sync when the slicc thread sends updates
(source of truth: slicc-emscripten `slicc/lib/` / `/tmp/claude-emcc/homescoop-shims/`).

| File | Role |
| --- | --- |
| `slicc_spawn.c` | `posix_spawn` / `waitpid` via `Module.sliccKernel` or node `child_process` |
| `slicc_exec.c` | `execve` over spawn (resets caught handlers; kernel forwards signals) |
| `slicc_fork.c` + `slicc-fork.js` | `fork` / `getpid` (`--js-library`, needs `-sASYNCIFY`) |
| `slicc_libc_gaps.c` | `splice` stub, sleeping `nanosleep`, `slicc_sigpipe()` |
| `slicc_signals.c` | POSIX signals in the wasm realm (`slicc_raise`, `slicc_sig_mask`, `kill`) |
| `slicc_select.c` | `pselect()` via the kernel (make `-jN` jobserver; Emscripten has none) |
| `slicc_main_envp.c` | `main` that passes `environ` (`-Dmain=slicc_tool_main`) |

## Link profiles (`homescoop_slicc_archive`)

Every profile includes `slicc_libc_gaps.c` + `slicc_signals.c`.

| Profile | Extra objects |
| --- | --- |
| `gaps` | (gaps + signals only) — e.g. pkgconf |
| `spawn` | spawn + exec — gnu tools that exec children |
| `make` | spawn + exec + main_envp + **select** — GNU make (`-jN` needs pselect) |
| `fork` | spawn + exec + fork — bash (+ `--js-library slicc-fork.js` / ASYNCIFY) |

Pull signal exports from the archive even when nothing in the tool references
them (the realm calls them from JS):

```bash
LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports) $WORK/libslicc.a"
```

(`-Wl,-u,slicc_raise -Wl,-u,slicc_sig_mask -Wl,-u,slicc_sigpipe`)

Keep `homescoop_em_cli_ldflags` (`ENVIRONMENT=web,worker,node`, `EXIT_RUNTIME`,
`ALLOW_MEMORY_GROWTH`) on every CLI link line.
