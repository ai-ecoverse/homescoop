# gmake (emscripten ABI)
Not linked against wasix-libc; F_SETFD wasix fix N/A.
Rebuilt in the wasix-sysroot 2025.9.30-14 sweep (`-lnodefs.js`).

## PRESTAGE
```sh
TMP=$(mktemp -d)
# place a tiny echo.{js,wasm} at $TMP/echo, then:
printf 'all:\n\t/work/echo ok-from-make\n' > $TMP/Makefile
SMOKE_WORKDIR=$TMP node scripts/run-wasm-cli.mjs packages/gmake/package/bin/make -- -C /work
# expect: ok-from-make
```
