# @ai-ecoverse/wasm-procps

procps-ng for the slicc wasm realm (`ps`, `pgrep`, `pkill`, `kill`, `free`,
`uptime`, `pidof`). Built without ncurses (`top` / `watch` omitted).

Requires a slicc-kernel with Linux-shaped `/proc` (per-pid plus
`uptime` / `meminfo` / `loadavg` / `stat`). Certification is owned by the
homescoop BB thread; new package — not Renovate-automerge until certified.

## Users (4.0.5-3, slicc-kernel ≥ 1.44.0)

`ps` names each process's owner (`USER`) from slicc-kernel's process
credentials and its `/etc/passwd`. Root sees every user's processes; a user
added with `kernel.users.add` sees its own.

