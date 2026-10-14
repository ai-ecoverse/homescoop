# `@ai-ecoverse/wasm-coreutils`

GNU coreutils (single-binary) for slicc.

```bash
pnpm add -g @ai-ecoverse/wasm-coreutils
```

## Device numbers (9.12.0-6)

`stat -c '%t:%T'` and `ls -l` show a device's major and minor numbers as
slicc-kernel reports them (`/dev/null` is `1, 3`). Up to 9.12.0-5 Emscripten's
`statx()` dropped them: `stat` said `0:0` and `ls -l` printed numbers left on
the stack (homescoop#324).

## Users (9.12.0-5, slicc-kernel ≥ 1.44.0)

`id`, `whoami`, `groups`, `logname`, `ls -l` and `stat` name users and groups
from slicc-kernel's process credentials and its `/etc/passwd` and
`/etc/group`:
- root (the kernel's default) is `uid=0(root)`;
- a user added with `kernel.users.add` gets its own uid, its groups (for
  example `users`) and its name.

There is no fallback: on an older kernel the ids are -1. File owners are the
kernel's, and 1.44.0 reports uid 1000 for every file.

