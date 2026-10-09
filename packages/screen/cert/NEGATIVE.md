# Negative proof (screen)

**Date:** 2026-10-09
No patches. Not in `scripts/ci-certified.json`.

## Known-bad build: today's recipe (5.0.1-7 as first built in #136)

The published 5.0.1-6 passes the checklist. It came from the slicc-emscripten
pipeline before this recipe, and its wasm reads `/etc/passwd` in `getpwuid`.
Rebuilt from this repo, screen links Emscripten's `getpwuid` stub, which
always returns NULL, so everything except `-v` fails (slicc-kernel 1.23.0,
Node entry):

```
screen -ls → rc 1, "getpwuid() can't identify your account!\r\n"
```

## Empty wasm

With `bin/screen.wasm` truncated to 0 bytes, the checklist fails at the first
`screen`.
