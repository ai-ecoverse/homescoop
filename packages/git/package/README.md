# `@ai-ecoverse/wasm-git`

Git 2.55.0 for slicc. Local repos work out of the box; HTTP(S) remotes go
through `@ai-ecoverse/wasm-curl` (Mbed TLS) and the realm's CONNECT / TLS
proxy (`http_proxy` / `https_proxy`, CA via `GIT_SSL_CAINFO`).

`GIT_EXEC_PATH` is set to `libexec/git-core` (relative → package root).
`/bin/sh` in the realm should be GNU bash (`@ai-ecoverse/wasm-bash`).

```bash
ipk add -g @ai-ecoverse/wasm-git @ai-ecoverse/wasm-bash
git init && git add . && git commit -m ok
```
