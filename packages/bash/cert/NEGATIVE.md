# Negative proof (bash)

**Date:** 2026-10-10
Patches: see `cert/meta.json`. Not in `scripts/ci-certified.json`.

## /dev/tcp: the fork-profile build (5.3.0-9 as first built, and 5.3.0-8)

bash linked the `fork` shim profile, which has no `slicc_socket.c`, so
connect() and getaddrinfo were Emscripten's (WebSocket SOCKFS). `cert/net.mjs`
fails at the first case (slicc-kernel 1.30.0, Node entry):

```
proxy round trip rc=1 stderr=bash: connect: Host is unreachable
```

Every target fails the same way: 127.0.0.1, `$(hostname)`, the refused
port, an unknown name and the tailnet name. With the `netfork` profile they
give the round trip, "Connection refused" and "Name does not resolve".

## exec keeps the pid (slicc-kernel#99/#176)

bash 5.3.0-7 (spawn + `execWait` shim) fails `cert/checklist.mjs` at the
first exec case (`exec bash: $$/$PPID 1002 1001 != 1001 1`). The shim-only
proof on 1.26.6 is `shims/slicc/test/exec.test.mjs`.

## umask (5.3.0-10)

Emscripten 4.0.23 implements `__syscall_umask` in wasm (a weak definition in
`emscripten_syscall_stubs.c`), so 5.3.0-8/-9 no longer import
`env.__syscall_umask`, the import slicc-kernel wraps (kernelUmask, #208).
`cert/umask.mjs` against the published 5.3.0-9 on slicc-kernel 1.35.1:

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ '644\n0022\n'
- '600\n0077\n'
```

(`umask 077; : > f` creates 644, and the kernel still has 0022.) 5.3.0-10
restores the import (shims/slicc/slicc_umask.c + slicc-fork.js). The import
lists of -9 and -10 differ only in `env.__syscall_umask`; of -7's
`__syscall_*` imports, -10 lacks socket/connect/sendmsg/getpeername/poll
(handled by the slicc socket shim since -9) and pipe2 (unimplemented in
4.0.23's C stubs; musl falls back to pipe + fcntl FD_CLOEXEC; cert/pipes.mjs
passes on -9 and -10).

## 5.3.0-11 (write boundaries), slicc-kernel 1.35.1 Node entry

`cert/writes.mjs` on 5.3.0-10 (emscripten 4.0.23 stock `doWritev`, one `FS.write` per iovec):

```
AssertionError [ERR_ASSERTION]: bash -c "echo one": writes ["one","\n"]
```

5.3.0-7 (an emscripten whose `doWritev` gathered the iovecs) passes the same spec.

## 5.3.0-11 (job control), slicc-kernel 1.35.1 Node entry

`cert/jobs.mjs` on 5.3.0-10 fails on the first ^C. The ^C is echoed, but `sleep 30` keeps running and the next line is typed into it:

```
AssertionError [ERR_ASSERTION]: step {"expect":"\\$ ","timeoutMs":5000}
```

The bisect used slicc-kernel's #240 tests (`test/unit/terminal.test.mjs`), ported to the published kernel, 3 runs each. Columns: typed at once / ^Z x 8 / 0-20-50 ms.

| bash | typed at once | ^Z x 8 | 0/20/50 ms |
| --- | --- | --- | --- |
| 5.3.0-7 | 3/3 | 3/3 | 1/3 |
| 5.3.0-8, -9, -10 | 0/3 | 0-1/3 | 0/3 |
| 5.3.0-7's own sources rebuilt with emscripten 4.0.23 | fails like -8 | | |
| 5.3.0-11 | 3/3 | 1/3 | 1/3 |

5.3.0-11's remaining failures are `kill -KILL %1` on a job stopped before it ran: the job is reaped only after a SIGCONT, a kernel-side issue reported to the coordinator. On a ^C 0 ms after the line is read, 5.3.0-10 delivers 0/5 and 5.3.0-11 3/5; at 100 ms and later both deliver 5/5. `cert/jobs.mjs` (^C and ^Z right after the shell has echoed the line, 20 each) passes on 5.3.0-11 and on 5.3.0-7.

