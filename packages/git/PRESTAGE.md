# git (emscripten ABI)
Not linked against wasix-libc; F_SETFD wasix fix N/A.
Rebuilt in the wasix-sysroot 2025.9.30-14 sweep.

## PRESTAGE
```sh
TMP=$(mktemp -d); G=packages/git/package/bin/git
SMOKE_WORKDIR=$TMP node scripts/run-wasm-cli.mjs $G -- -c 'safe.directory=*' init
SMOKE_WORKDIR=$TMP node scripts/run-wasm-cli.mjs $G -- -c 'safe.directory=*' \
  -c user.email=t@t -c user.name=t commit --allow-empty -m prestage
SMOKE_WORKDIR=$TMP node scripts/run-wasm-cli.mjs $G -- -c 'safe.directory=*' \
  -c core.pager=cat log -1
# expect: commit message `prestage`
```
