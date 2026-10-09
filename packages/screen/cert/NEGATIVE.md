# Negative proof (screen)

**Date:** 2026-10-09
No patches. Not in `scripts/ci-certified.json`. All runs are on slicc-kernel
1.26.6 (Node entry).

## Known-bad build 1: no passwd lookups (5.0.1-7 before slicc_pwd.c)

Rebuilt from this repo before #146, screen linked Emscripten's `getpwuid`
stub, which always returns NULL. Everything except `-v` fails:

```
screen -ls → rc 1, "getpwuid() can't identify your account!\r\n"
```

## Known-bad build 2: the old exec shim (published 5.0.1-6)

5.0.1-6 (old slicc-emscripten pipeline) reads `/etc/passwd` but execs the
window program through spawn + `execWait`. The window's parent is then the
intermediate forked child, not the screen server, and its own pid is not
one the kernel knows:

```
window's parent is not the screen server:
  "There is a screen on:\r\n\t1012.w\t(Detached)\n…ids 1015 1016\ncmd \n"
```

With #146 and the current exec shim, the window's `$PPID` is the server pid
from `-ls`, and `/proc/<pid>/cmdline` is the program (`sleep 20`, which bash
exec'd under the same pid).

## Empty wasm

With `bin/screen.wasm` truncated to 0 bytes, the checklist fails at the first
`screen`.
