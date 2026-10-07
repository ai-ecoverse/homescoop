# procps PRESTAGE

## Depends on slicc-kernel /proc

procps-ng reads:

| Path | Used by |
| --- | --- |
| `/proc/<pid>/{cmdline,stat,status,comm}` | `ps`, `pgrep`, `pkill`, `pidof` |
| `/proc/self` | usual |
| `/proc/uptime` | `uptime` |
| `/proc/meminfo` | `free` |
| `/proc/loadavg` | `uptime` |
| `/proc/stat` | misc |

Coordinate with @thread:thr_ej75dimgf5 for a slicc-kernel#66-era prerelease
(or `dist/` tarball) before claiming cert green.

## Build

```bash
bash scripts/host-run.sh procps
```

`--without-ncurses`: no `top` / `watch`. Ship: `ps`, `pgrep`, `pkill`, `kill`,
`free`, `uptime`, `pidof`.

## Cert

```bash
export HOMESCOOP_CERT_NODE_MODULES=…  # must include #66-era slicc-kernel
node scripts/browser-cert/run.mjs --package procps --tarball .homescoop-out/package.tgz
```
