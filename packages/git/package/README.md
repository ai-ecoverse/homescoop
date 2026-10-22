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

## Shell subcommands and local clones (2.55.0-18)

`git submodule`, `git mergetool` and the other shell-script subcommands run
through `git-sh-setup`, which needs `sed`, so this package depends on
`@ai-ecoverse/wasm-sed`. `git clone --local` copies the objects when the file
system has no hard links (slicc's OPFS root), as `--no-hardlinks` does. It
needs slicc-kernel 1.130.2 or later.

## Users (2.55.0-14, slicc-kernel ≥ 1.47.1)

git runs as the kernel's user. Without `user.name`, the author name comes from
slicc-kernel's `/etc/passwd` for the process's uid: `root` by default, or a
`kernel.users.add` user's name. Repository ownership checks (`safe.directory`)
use the file owners the kernel reports (≥ 1.47.1: the calling user's ids).

## Two browser tabs (2.55.0-20)

git guards the index and refs with lock files (`index.lock`, ref `.lock`
files), not `flock`. Files written in one browser tab may still read stale or
corrupted in another until
[slicc-kernel#949](https://github.com/ai-ecoverse/slicc-kernel/issues/949) is
fixed, so a lock file or a ref one tab wrote may not be seen by the other.
Work on one repository from one tab at a time; several git processes in one
tab are unaffected.

## Build paths (2.55.0-20)

No wasm in this package names the machine it was built on. git-remote-http(s),
git-http-fetch and git-remote-ftp(s) link libcurl and Mbed TLS from
`@ai-ecoverse/wasm-curl`; up to 2.55.0-19 they were built against
wasm-curl 8.22.0-6, whose Mbed TLS archive still named
`/tmp/homescoop-work/mbedtls-3.6.5/…` (homescoop#1008). 2.55.0-20 links
wasm-curl 8.22.0-9, and the build refuses any wasm that names a build path.
