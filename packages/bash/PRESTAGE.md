# bash (emscripten ABI)
Not linked against wasix-libc; F_SETFD wasix fix N/A.
Rebuilt in the wasix-sysroot 2025.9.30-14 sweep (`-lnodefs.js`).

## PRESTAGE
```sh
# builtin
SMOKE_WORKDIR=$TMP node scripts/run-wasm-cli.mjs packages/bash/package/bin/bash -- -c 'echo hi'
# expect: hi

# exec/spawn: place a tiny echo.{js,wasm} helper in $TMP as `echo`, then:
SMOKE_ENV=PATH=/work SMOKE_WORKDIR=$TMP \
  node scripts/run-wasm-cli.mjs packages/bash/package/bin/bash -- -c 'exec /work/echo ok'
# expect: ok
```
