# Negative proof (bash)

**Date:** 2026-10-10
Patches: see `cert/meta.json`. Not in `scripts/ci-certified.json`.

**5.3.0-15 and 5.3.0-16 were never served by npm.** 5.3.0-15's publish (sha256 7aba06d1…) was left staged (npm/cli#9889: E409 on retry, `npm stage list` empty, 404 after an hour); 5.3.0-16 (b1fdaa47…, the same build re-issued) went the same way at about 00:01Z on 2026-10-11, while other packages published in that window were served within minutes. Both numbers are burned. 5.3.0-17 is that certified build re-issued again with only the version changed (package.json, and the README's patch-list heading and note). Where this file says 5.3.0-15, the measurements apply to 5.3.0-17 unchanged.




## Self-kill is a plain exit (published 5.3.0-17, slicc-kernel#422)

`selfkill.mjs` (homescoop shim test `shims/slicc/test/selfkill.test.mjs` for the C side): 5.3.0-17's `kill(getpid(), sig)` runs the default action in the program (`exit(128 + sig)`), so the kernel reports `kill -TERM $$` as `{ status: 143 }` with no signal for `wait`, and status 143 for `sync.run` (slicc-jsh#97); it cannot be told from `exit 143`.

## The line after a late ^C: 5.3.0-14 (and 5.3.0-13)

A ^C that slicc-kernel handed over late (readline only noticed it when more input arrived) made -14 free the *next* line: bth's 1.47.1/1.47.3 cert lost 40-45 per 500 rounds. 5.3.0-13 runs it, but with what readline held from before the ^C glued on ("techo", "0echo"), or loses it.

The next-line phase alone, 40 rounds per build and kernel (fresh pty each; `true`, ^C 1..5 ms later, `echo nextN`):

| bash | slicc-kernel main 749ab1e (#303) | 1.47.1 |
| --- | --- | --- |
| 5.3.0-13 | 3 lost | 7 lost |
| 5.3.0-15 | 0 lost | 0 lost |

5.3.0-14 fails `cert/sigint-line.mjs`'s next-line phase (3/20).

On 1.47.1 (before slicc-kernel#303) 5.3.0-15 can still lose a line: a stray character is read before readline notices the late ^C. Measured: 2 of 120 next lines (0/40 in the table above; 1/60 over three local runs of the cert's 20-line phase; 1/20 in CI run 38085440941), and in the runs where it happens, 1 of 20. 5.3.0-13 lost 7/40 on the same kernel. The cert therefore runs on 1.48.3.

### Why `engines` asks for slicc-kernel ≥ 1.48.3

bth's cert of 5.3.0-15 (1300 rounds on 1.47.1, 500 on 1.48.3):

| slicc-kernel | 5.3.0-13 shell exits | 5.3.0-15 shell exits |
| --- | --- | --- |
| 1.47.1 | 72 / 1300 | 108 / 1300 |
| 1.48.3 | | 0 / 500 (no partial command, no lost line, no exit) |

On 1.47.1 every extra -15 exit is in that kernel's race-(b) window: -15 correctly drops the truncated line, and the shell then hits the kernel's EOF race and exits. 1.48.3 is the first kernel with race (b) fixed and slicc-kernel#303, and there -15 is clean. So 5.3.0-15 declares `engines.slicc-kernel` `>=1.48.3` rather than trade fewer partial commands for more shell exits on older kernels.

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


## 5.3.0-19: ulimit (homescoop#178, 2026-10-16)

`ulimit.mjs` against the published 5.3.0-18 (slicc-kernel 1.73.2, the cert kernel): FAIL, as root. `ulimit -S -n 64` is refused with `cannot modify limit: Operation not permitted`, and so is every other change: `-S -c 0`, `-H -n 1024`, and even `-S -n 5000` over the hard limit, which should be `Invalid argument`. stdout shows 4096 at every step. Emscripten's libc compiles `__syscall_prlimit64` in as a stub that refuses any new limit with EPERM and never asks the kernel. 5.3.0-19 links the shims' `__syscall_prlimit64` and passes.

## 5.3.0-19: 40 symlink follows in redirections (homescoop#611, 2026-10-16)

`symloop.mjs` against the published 5.3.0-18: FAIL at its first assertion, because `bin/bash`'s `FS.lookupPath` still has `nlinks < 40`. That release predates `scripts/emsdk-patches/libfs-symloop.patch` (#603). With that check switched off, the 40-link case fails: `bash: line 1: /tmp/s40/l0: Symbolic link loop`, rc 1. 39 links work. 5.3.0-19 is built with the patch.

## 5.3.0-20: no DWARF, no build paths (homescoop#908; 2026-10-17)

`node scripts/check-no-debug.mjs bash` (host-run's #908 check) fails on the published 5.3.0-19: 1 file(s) ship 3,201,734 bytes of DWARF.

The published 5.3.0-19 also has 7 occurrence(s) of the CI build directory `/tmp/homescoop-work` in bin/bash.wasm (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

5.3.0-20 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 5.3.0-19 too; the negative is the #908 check.

## cert/siginherit-tree.mjs (was cert/k122/siginherit.mjs, an extra kernel row on 1.122.0; homescoop#973, slicc-kernel#967)

On 1.122.0 the kernel reports inherited ignores before constructors run, so `cert/siginherit-tree.mjs` has no lenient branch. The published 5.3.0-19 fails it:

```text
AssertionError: the child bash shows the inherited SIGPIPE ignore, and no TERM trap: ""
```

5.3.0-20 passes. The child shows `trap -- '' SIGPIPE`. A grandchild under `trap '' PIPE INT` shows both. An ignore set in a finished subshell is not inherited.

## A ^C while bash forks, with the child's setpgid held (homescoop#1230)

`test/fork-sigint.mjs` (the `ci` check) on slicc-kernel 1.129.0, which has `setTestSyscallHook` but not slicc-kernel#1146's fix (users enforce, 2026-10-19):

```text
wasm-bash 5.3.0-20: AssertionError: round 1: [child forked, bash exit, "after" printed] … actual [true, 130, false], expected [true, null, true]
wasm-bash 5.3.0-19: 3 rounds … bash keeps the terminal and reads its next line
```

On 1.130.2 (the fix), both 5.3.0-19 and -20 pass, so this is the regression guard. The kernel's own row (`test/integration/settling-inherited.test.mjs`) fails the same way on 1.129.0 with -20.

## 5.3.0-21: a ^C never interrupts a loop of builtins (homescoop#1236)

`cert/builtin-loop-sigint.mjs` against the published 5.3.0-21 (slicc-kernel 1.130.2, users enforce, 2026-10-20) fails:

```text
browser-cert: FAIL packages/bash/cert/builtin-loop-sigint.mjs
AssertionError [ERR_ASSERTION]: i=0; while ((i<50000000)); do ((i++)); done; echo after=$i: a ^C 300 ms in didn't bring bash back to its prompt
```

The loop makes no kernel call, so the SIGINT stays pending until it ends. 5.3.0-22's `quit-signal-poll.patch` sleeps 0 ms through the shim every 1024 `QUIT`s; the kernel delivers the SIGINT on the way back, and bash throws to the top level. 5.3.0-22 passes every spec on 1.130.2.

## 5.3.0-23: shim drift (homescoop#1491; 2026-10-20)

5.3.0-23 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 5.3.0-22 in `THIRD-PARTY-NOTICES.md`, `bin/bash` and `bin/bash.wasm`, so this is a packaging bump. The package's own code is unchanged. `THIRD-PARTY-NOTICES.md` also gains the slicc-shims section that every wasm linking the shims now carries (homescoop#1388). The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.

## slicc-kernel 1.135.1: kill -INT $$ after trap - INT under an inherited INT ignore (homescoop#1113)

`cert/selfkill.mjs` (`--soft`) with the published 5.3.0-22 on slicc-kernel 1.135.1 (users enforce, 2026-10-20) fails 2 of its 20 assertions. Under `trap '' INT`, the child `bash -c 'trap - INT; kill -INT $$'` never returns, and the row's 20 s `kill -KILL` ends it, so the output is `i1\nrc=0\nrc=137\n` and not `i1\nrc=0\nrc=130\n`. The cause was in the kernel: the shim's reset of an inherited SIG_IGN never reached the kernel, which went on dropping the self-sent SIGINT (slicc-kernel#1258). slicc-kernel 1.136.8 (#1260) fixes it, and the same tarball passes there. It's the cert kernel now. GNU bash 5.3.15 prints `i1`, `rc=0`, `rc=130`.

## 5.3.0-22: env -i bash gets Emscripten's default environment (homescoop#1418)

`cert/env-i.mjs` (`--soft`) with the published 5.3.0-22 on slicc-kernel 1.136.8 (users enforce, 2026-10-21) fails 11 of its 16 assertions. `env -i bash -c 'echo "[$PATH] [$HOME] [$USER] [$LOGNAME] [$LANG]"'` prints `[/] [/home/web_user] [web_user] [web_user] [en_US.UTF-8]`, and `export -p` lists HOME, LANG, LOGNAME, PATH and USER besides HOSTNAME, OLDPWD, PWD and SHLVL: Emscripten's `getEnvStrings` defaults. 5.3.0-23 links `shims/slicc/slicc-env.js` (#1491), which builds the environment from the kernel's values only. It prints bash's own default PATH with the other four empty, and exports only HOSTNAME, OLDPWD, PWD and SHLVL.
