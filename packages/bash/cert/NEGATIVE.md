# Negative proof (bash)

**Date:** 2026-10-10
Patches: see `cert/meta.json`. Not in `scripts/ci-certified.json`.




## The line after a late ^C: 5.3.0-14 (and 5.3.0-13)

A ^C that slicc-kernel handed over late (readline only noticed it when more input arrived) made -14 free the *next* line: bth's 1.47.1/1.47.3 cert lost 40-45 per 500 rounds. 5.3.0-13 runs it, but with what readline held from before the ^C glued on ("techo", "0echo"), or loses it.

The next-line phase alone, 40 rounds per build and kernel (fresh pty each; `true`, ^C 1..5 ms later, `echo nextN`):

| bash | slicc-kernel main 749ab1e (#303) | 1.47.1 |
| --- | --- | --- |
| 5.3.0-13 | 3 lost | 7 lost |
| 5.3.0-15 | 0 lost | 0 lost |

5.3.0-14 fails `cert/sigint-line.mjs`'s next-line phase (3/20).

## ^C while readline echoes the accepted line: 5.3.0-13

`cert/sigint-line.mjs` on 5.3.0-13, slicc-kernel 1.44.0 Node entry. 2 of 3 runs failed within the first rounds:

```text
AssertionError [ERR_ASSERTION]: round 3: a partial line ran:
bash: leep: command not found
```

`shell_getc` had taken `s` from readline's line when `QUIT` threw to the top level. readline's line and index survived, so the next parse ran the rest. On a longer line it can merge with the next one (`lecho: command not found`).

## Process credentials: 5.3.0-12 (H1, homescoop#207)

`cert/users.mjs` on the published 5.3.0-12, slicc-kernel 1.44.0 Node entry. Its shims answer uid 1000 for everyone, so root is uid 1000 and its prompt names whoever `/etc/passwd` lists as 1000:

```text
+   'UID=1000 EUID=1000 GROUPS=1000 0 HOME=/root USER=root',
+   'prompt=cone $',
-   'UID=0 EUID=0 GROUPS=0 HOME=/root USER=root',
-   'prompt=root #',
```

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
| 5.3.0-11 | 3/3 | 3/3 | 1/3 (test race, fixed in #242's test) |

With only jobs-parent-terminal.patch, `kill -KILL %1` on a job stopped before it ran left it "Stopped" until the shell's next fork (kst2: 3-6 of 8). The kernel reported the death correctly (thr_r99i6mnbaf's trace). The SIGCHLD arrived a few ms after `kill`, at a kernel call inside `notify_of_job_status`, which holds SIGCHLD with a bare `queue_sigchld++/--` and dropped it. A debug build showed the handler running with `queue_sigchld=1`. In 5.3.0-12, jobs-notify-unqueue.patch fixes that: the #240 port gives typed at once 3/3, ^Z x 8 3/3, and kst2 0 failures in 24 rounds. The 0/20/50 ms test's remaining 1/3 is the test race fixed in slicc-kernel #242's test (a queued `jobs` flushed by the next ^C). `cert/jobs.mjs` (now with `kill -KILL` and no SIGCONT, expecting "Killed") fails on the published 5.3.0-11 (58cdd390) at that step. On a ^C 0 ms after the line is read, 5.3.0-10 delivers 0/5 and 5.3.0-11 3/5; at 100 ms and later both deliver 5/5. `cert/jobs.mjs` (^C and ^Z right after the shell has echoed the line, 20 each) passes on 5.3.0-11 and on 5.3.0-7.

### 5.3.0-12: the fork window
In CI, 58cdd390's successor lost the first ^C of `cert/jobs.mjs`. A key that reaches the shell while it is still forking, or the child before it has set itself up, went to a handler that only records it: the shell's own `sigint_sighandler`, or its ignored SIGTSTP. Locally, with ^C or ^Z right after the shell echoed the line, 20 rounds per run:

| build | ^C | ^Z |
| --- | --- | --- |
| 5.3.0-11 (published) | 19/20 | 20/20 |
| parent hand-off and unqueue only | 18-19/20 | 19/20 |
| 5.3.0-12 (record and pass on; exec shim acts on a pending one) | 80/80 | 80/80 |
| 5.3.0-7 | 60/60 | 60/60 |

5.3.0-12 also passes slicc-kernel's three #240 tests (ported) 3/3 each, ^C to subshell and builtin jobs 5/5, and kill-after-early-^Z with 0 failures in 48 rounds.

