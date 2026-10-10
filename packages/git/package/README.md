# `@ai-ecoverse/wasm-git`

Git 2.55.0 for slicc. Local repos work out of the box; HTTP(S) remotes go
through `@ai-ecoverse/wasm-curl` (Mbed TLS) and the realm's CONNECT / TLS
proxy (`http_proxy` / `https_proxy`, CA via `GIT_SSL_CAINFO`).

`GIT_EXEC_PATH` is set to `libexec/git-core` (relative → package root).

Git runs some things through `/bin/sh`: local and `file://` remotes (it starts
`git-upload-pack` / `git-receive-pack` with `sh -c`), ssh remotes, hooks and
`!` aliases. SLICC and slicc-kernel resolve `sh` to GNU bash, so this package
depends on `@ai-ecoverse/wasm-bash`; without it, `git clone /path/to/repo`
fails with `cannot exec 'git-upload-pack …'`.

```bash
pnpm add -g @ai-ecoverse/wasm-git
git init && git add . && git commit -m ok
```

## Users (2.55.0-14, slicc-kernel ≥ 1.44.0)

git runs as the kernel's user. Without `user.name`, the author name comes from
slicc-kernel's `/etc/passwd` for the process's uid: `root` by default, or a
`kernel.users.add` user's name. Repository ownership checks (`safe.directory`)
use the file owners the kernel reports.
