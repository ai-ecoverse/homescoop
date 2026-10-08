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
