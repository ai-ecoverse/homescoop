# Negative proof (screen)

**Date:** 2026-10-09
No patches. Not in `scripts/ci-certified.json`. All runs are on slicc-kernel
1.26.6 (Node entry).

## One socket directory for everyone (published 5.0.1-9, users enforce)

`users.mjs` on slicc-kernel 1.69.0 with users `enforce` (Node entry, 2026-10-13). 5.0.1-9 predates the cred shim (#207) and the package sets `SCREENDIR=/tmp/screens` for every user. The first user to start screen creates `/tmp/screens` as its own, mode 700; any other user's `screen -dmS` then returns 0 but starts nothing:

```text
# scoop-a: screen -dmS scoopsess sleep 60; screen -ls
There is a screen on:
	1003.scoopsess	(Remote or dead)
1 Socket in /tmp/screens.
drwx------ 1 scoop-a scoop-a 4096 … /tmp/screens
# cone: screen -dmS conesess sleep 60; echo rc=$?; screen -ls
rc=0
No Sockets found in /tmp/screens.
```

The kernel's file permissions kept the sessions apart (cone cannot read scoop-a's directory), but only one user could use screen at all. 5.0.1-10 keeps each user's sockets in `~/.screen` and knows its real ids.

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

## Reattach from a second terminal (5.0.1-8, homescoop#162)

`cert/reattach.mjs` requires attach == visibility of the attaching terminal's
device from inside the session. On slicc-kernel 1.30.0 that device is
invisible (`ls: cannot access '/dev/tty2': No such file or directory`, run
in the session through `-X stuff`), so the case asserts the documented limit.

- **Strict variant** (require the attach): fails on 1.30.0, which is the bug.
  ```
  FAIL STRICT: not attached
  ```
  An instrumented build logged the server's side: `CTD type=2 recvfd=-1
  m_tty=/dev/tty2` → `secopen(/dev/tty2) failed errno=44`. No fd arrives
  (no SCM_RIGHTS on kernel sockets), and the path is not visible
  (slicc-kernel#192).
- **Positive branch:** with the attaching terminal opened first, it is
  `/dev/tty1`, the one device every process sees. Then `screen -r` from it
  reattaches fully (window redrawn, `$STY` = `1002.ra`, `[screen is
  terminating]` on exit), on the same build and kernel. Once #192 ships, the
  case requires exactly that from any terminal.

## Reattach from a second terminal, strict (5.0.1-9, slicc-kernel 1.35.1)

`cert/reattach.mjs` now requires the attach. On slicc-kernel 1.34.1 (before
#210) it fails at the visibility check:

```text
AssertionError [ERR_ASSERTION]: terminal B's device is not visible from the session: "ls: cannot access '/dev/tty2': No such file or directory\nvis-done\n"
```

On 1.35.1 it passes, with the published 5.0.1-8 binary as well: the screen
side needed no change.

## A build-day date in screen -v (5.0.1-10, #497)

Up to 5.0.1-10, `BUILD_DATE` in screen's `Makefile.in` was the time of the build, so
`bin/screen.wasm` differed between two builds of the same tree (npm-parity sweeps
38867940630 and 38873494942: same size, different bytes). `cert/checklist.mjs` now
expects the date from `source.epoch`. Against the published 5.0.1-10 it fails:

```text
AssertionError [ERR_ASSERTION]: BUILD_DATE comes from source.epoch (SOURCE_DATE_EPOCH), not the build day
+ 'Screen version 5.0.1 (build on 2026-10-13 02:10:52) \n'
- 'Screen version 5.0.1 (build on 2025-05-15 15:05:28) \n'
```

## 5.0.1-13: the inherited-ignore and flock shims (homescoop#973, #947; 2026-10-17)

5.0.1-13 links the updated `shims/slicc` (#960). A `constructor(101)` in `slicc_signals.c` seeds `SIG_IGN` for each signal the kernel's `sliccKernel.sigInherited()` reports; on a kernel without the hook it changes nothing. A strong `flock()` in `slicc_libc_gaps.c` goes through the `env.__syscall_flock` import, which answers 0 without the kernel half (slicc-kernel#967 and #968). The built wasm now imports `env.slicc_sig_inherited_js`, and `env.__syscall_flock` where the program calls `flock`. The published 5.0.1-12 imports neither, so on a hooked kernel it can't see an inherited ignore, and its `flock` never conflicts. The program code is unchanged, and the specs pass on 5.0.1-12 as well. The build also gets #908's prefix maps and DWARF strip.
