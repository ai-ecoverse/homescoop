# procps PRESTAGE / release gate

procps first shipped as 4.0.5-1 (#54) once slicc-kernel 1.9.0 put `/proc` on
npm (#66). Releases now go through ladder-build: it builds the recipe twice and
compares the packages, certifies the tarball, and publishes it on merge.

## Command set

Ship: `ps`, `pgrep`, `pkill`, `kill`, `free`, `uptime`, `pidof`.  
Skip `top` / `watch` (`--without-ncurses`).

## Depends on slicc-kernel /proc

| Path | Used by |
| --- | --- |
| `/proc/<pid>/{cmdline,stat,status,comm}` (+ `/proc/self`) | `ps`, `pgrep`, `pkill`, `pidof` |
| `/proc/uptime`, `/proc/loadavg` | `uptime` |
| `/proc/meminfo` | `free` |
| `/proc/stat` | misc |

Proven green against `slicc-kernel-procfs-ed6d6a1.tgz` (pre-#66 attach).  
Re-prove against the **released** kernel after #66.

## First release (4.0.5-1, done)

slicc-kernel 1.9.0 shipped `/proc` (#66), the cert ran on it (the pin is now
1.14.0 or later, see `cert/meta.json`), the packaging-only coreutils 9.12.0-2
went out in the same window, and procps was published and merged with #54.

## Alongside first publish: coreutils packaging-only

`wasm-coreutils` advertises useless `uptime` and `kill` multi-call stubs
(no utmp / no applet). Prefer **one provider** for process tools → procps.

Overlaps (procps ∩ coreutils `slicc.commands` on `@ai-ecoverse/wasm-coreutils@9.12.0-1`):

| Command | coreutils | Action |
| --- | --- | --- |
| `uptime` | yes (stub) | **Remove** from coreutils `slicc.commands` |
| `kill` | yes (stub) | **Remove** — procps ships `bin/kill` (+ `slicc.commands.kill`). Bash builtin covers interactive/script `kill`; `env kill` / `xargs kill` need the PATH binary from procps. Confirmed: `env kill -TERM <pid>` works with coreutils `9.12.0-2` + procps (in cert). |
| `ps` / `pgrep` / `pkill` / `free` / `pidof` | no | — |

Packaging-only bump `9.12.0-1` → `9.12.0-2`: same `bin/*` bytes, only
`package.json` differs (same file-by-file rule as wasm-git `-9`).  
Helper: `scripts/packaging-only-coreutils-drop-procps-clashes.mjs`.  
It went out in the same window as procps’s first publish.

## Build

```bash
bash scripts/host-run.sh procps
```

## Post-land kernel pins

- Browser-cert kernel pin: `1.14.0` (pnpm global command roots; real VSZ/RSS + meminfo used via 1.12.0; USER via 1.11.0).
- Published npm packages unchanged; no procps republish.

