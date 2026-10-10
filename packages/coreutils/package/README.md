# `@ai-ecoverse/wasm-coreutils`

GNU coreutils (single-binary) for slicc.

```bash
pnpm add -g @ai-ecoverse/wasm-coreutils
```

## Users (9.12.0-5, slicc-kernel ≥ 1.44.0)

`id`, `whoami`, `groups`, `logname`, `ls -l` and `stat` name users and groups
from slicc-kernel's process credentials and its `/etc/passwd` and
`/etc/group`:
- root (the kernel's default) is `uid=0(root)`;
- a user added with `kernel.users.add` gets its own uid, its groups (for
  example `users`) and its name.

There is no fallback: on an older kernel the ids are -1. File owners are the
kernel's, and 1.44.0 reports uid 1000 for every file.

