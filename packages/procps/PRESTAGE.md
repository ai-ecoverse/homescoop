# procps PRESTAGE / release gate

**#54 held for publish** — slicc-kernel 1.9.0 is on npm (#66). Clear `blocked`,
CI browser-cert on 1.9.0, human-cert both tarballs, then `certified=` publish + merge.

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

1. ~~Wait for slicc-kernel #66~~ → **1.9.0 on npm.**
2. Clear `cert/meta.json` `"blocked"`; pin `"kernel": "@ai-ecoverse/slicc-kernel@1.9.0"`.
3. `FORCE=1 bash scripts/host-run.sh procps` → tarball + sha256.
4. Packaging-only coreutils `9.12.0-2` via
   `node scripts/packaging-only-coreutils-drop-procps-clashes.mjs`.
5. Local + CI browser-cert on 1.9.0 (CI installs -2 via `needsTarballScripts`).
6. Send both tarballs + sha256 to thr_b83wwqmt4e (attached-worker `ps` in browser).
7. Publish exact artifacts (`certified=<sha256>`), then land #54.
8. Add `procps` to `scripts/ci-certified.json` **only after** first manual cert.

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
