# @ai-ecoverse/wasm-procps

procps-ng for the slicc wasm realm (`ps`, `pgrep`, `pkill`, `kill`, `free`,
`uptime`, `pidof`). Built without ncurses (`top` / `watch` omitted).

Requires a slicc-kernel with Linux-shaped `/proc` (per-pid plus
`uptime` / `meminfo` / `loadavg` / `stat`). Certification is owned by the
homescoop BB thread; new package — not Renovate-automerge until certified.
