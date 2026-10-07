# procps PRESTAGE / release gate

**Hold #54 unmerged** until slicc-kernel #66 is released on npm.

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

## Release sequence (Lars / thr_b83wwqmt4e)

1. Wait for `@ai-ecoverse/slicc-kernel` release that includes #66 (+ /proc).
2. Clear `cert/meta.json` `"blocked"` so ladder-pr browser-cert runs (kernel
   /proc inside slicc-kernel CDP — not the runner’s /proc).
3. `FORCE=1 bash scripts/host-run.sh procps` → tarball + `sha256sum`.
4. Re-run cert against the **released** kernel (not the prerelease tarball):
   ```bash
   npm install --prefix /tmp/cert-nm @ai-ecoverse/slicc-kernel@<released> …
   export HOMESCOOP_CERT_NODE_MODULES=/tmp/cert-nm/node_modules
   node scripts/browser-cert/run.mjs --package procps --tarball <tgz>
   ```
5. Send tarball + sha256 to thr_b83wwqmt4e for browser cert (including
   attached-worker process visible in terminal `ps`).
6. Publish exact artifact (`certified=<sha256>`), then land #54.
7. Add `procps` to `scripts/ci-certified.json` **only after** that first
   manual cert (and after `blocked` is cleared).

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
Publish that certified tarball in the same window as procps’s first publish.

## Build

```bash
bash scripts/host-run.sh procps
```
