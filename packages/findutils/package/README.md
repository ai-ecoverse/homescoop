# `@ai-ecoverse/wasm-findutils`

[GNU findutils](https://www.gnu.org/software/findutils/) 4.11.0 for slicc's
wasm realm: `find` and `xargs` only (no `locate` / `updatedb`).

`-exec` / `-execdir` / `-ok` and `xargs` (including `-P`) go through slicc's
fork + `slicc_spawn` path.

Since 4.11.0-2 `find` and `xargs` run as the process slicc-kernel says they
are (the slicc credential library, homescoop#459) and look users and groups
up in the kernel's `/etc/passwd` and `/etc/group`, so `-user root`,
`-user cone`, `-uid 0`, `-group`, `-nouser` and `-printf '%u %g'` work under
users mode. 4.11.0-1 rejected user names and showed numbers.

```bash
pnpm add -g @ai-ecoverse/wasm-findutils
find . -name '*.c' -type f
find . -print0 | xargs -0 echo
```
