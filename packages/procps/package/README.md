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


## Licences (4.0.7-6, homescoop#1878)

The package ships two licence files from the procps-ng source:

- `LICENSE` is procps-ng's `COPYING`, the GNU General Public License,
  version 2. It covers the commands (`ps`, `pgrep`, `pkill`, `kill`, `free`,
  `uptime`, `pidof`), which are GPL-2.0-or-later.
- `COPYING.LIB` is procps-ng's `COPYING.LIB`, the GNU Library General Public
  License, version 2. It covers libproc2 (procps-ng's `library/`), which every
  command links statically. libproc2's sources say they are under the GNU
  Lesser General Public License, version 2.1 or later, and `COPYING.LIB` is
  the licence text upstream ships with them.

The package licence is therefore `GPL-2.0-or-later AND LGPL-2.1-or-later`.
4.0.7-5 and earlier shipped only `COPYING`. `THIRD-PARTY-NOTICES.md` covers
the Emscripten runtime and the homescoop shims linked into the wasm.
