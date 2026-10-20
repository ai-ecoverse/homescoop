# Negative proof (coreutils)

**Date:** 2026-10-07


## Users: 9.12.0-4 (H1, homescoop#207)

`cert/users.mjs` on the published 9.12.0-4, slicc-kernel 1.44.0 Node entry. Everyone is uid 1000, and no name resolves: `getpwuid` was Emscripten's stub, because build-gnu-cli.sh linked no `--wrap`. Root's lines:

```text
+   'uid=1000 gid=1000 groups=1000',
+   '1000',
+   '1000',
+   '1000',
-   'uid=0(root) gid=0(root) groups=0(root)',
-   '0',
-   'root',
-   'root',
```

whoami: "cannot find name for user ID 1000". An intermediate H1 build without `setgrent/getgrent` and `ac_cv_func_getgroups_works=yes` showed `groups=1000(cone)` without `users`, and `id -G cone` failed with "I/O error".

## Empty wasm (spec not vacuous)

`node scripts/browser-cert/prove-negative.mjs --package coreutils --tarball <good.tgz>`  
→ FAIL (empty `.wasm` / non-zero status on pipe or env cases).

## Patch reverted (gnulib-emscripten-locale.patch)

Remove `packages/coreutils/gnulib-emscripten-locale.patch` and run
`bash scripts/host-run.sh coreutils` (2026-10-07).

**Result:** compile fails:

```text
lib/getlocalename_l-unsafe.c:669:3: error: "Please port gnulib getlocalename_l-unsafe.c to your platform! Report this to bug-gnulib."
gmake[2]: *** [Makefile:16266: lib/libcoreutils_a-getlocalename_l-unsafe.o] Error 1
```

**Good tarball:** `@ai-ecoverse/wasm-coreutils@9.12.0-2` — `cert/checklist.mjs` passes
(pipes, env, nice, nohup, `LC_ALL=C sort`).

## timeout-slicc.patch (9.12.0-4, homescoop#88)

Without the patch, `timeout` is either not built (stock configure: the
emsdk `sigsuspend` link probe fails, so `timeout` is not in
`optional_bin_progs`) or, with `ac_cv_func_sigsuspend=yes`, built on
`fork()`, which the slicc `cli` profile does not provide (Emscripten's stub
fails), so every case in `cert/timeout-hostname.mjs` fails: the binary is
absent from `coreutils --help` and `slicc.commands`, or `timeout` exits 125
with "fork system call failed".

## 9.12.0-6: negative 9.12.0-5 (homescoop#324)

`rdev.mjs` against the published 9.12.0-5 on slicc-kernel 1.77.0's Node entry, 2026-10-14: FAIL, `stat %t:%T: /dev/null character special file 0:0` (expected 1:3). The kernel's `st_rdev` is right; Emscripten's `statx()` fallback dropped it.

`glue-mode.mjs` against 9.12.0-5 on slicc-kernel 1.88.0 (users enforce), 2026-10-15: FAIL: `bin/coreutils` is 644 in the tarball, and running it by path as cone gives `bash: line 1: …/bin/coreutils: Permission denied`, rc 126.

`linkat.mjs` against 9.12.0-5, 2026-10-15: FAIL at its first assertion, `coreutils.wasm imports env.__syscall_linkat`. -5 has no such import (Emscripten's weak C stub answers EMLINK inside the wasm), so even slicc-kernel 1.90.0 can't link for it.

## 9.12.0-7: negative 9.12.0-6 (uname import, emsdk paths)

`uname.mjs` on published 9.12.0-6: coreutils.wasm has no `env.__syscall_uname` import (Emscripten's weak C stub answers inside the wasm, so no kernel can), and its debug strings name `/home/runner/.cache/emsdk/0.4.0/install/...`.

## uname.mjs's Linux branch (homescoop#425)

Until 2026-10-16 the cert kernel was 1.88.0, which doesn't answer `env.__syscall_uname`, so CI only ran the fallback branch. The cert kernel is now 1.100.4 (slicc-kernel answers the import from 1.98.0 on, #701), and the spec reads the kernel version from `/proc/version`: on a kernel >= 1.98.0 it requires the Linux branch. Runs of `run.mjs --spec uname.mjs`, 2026-10-16:

- published 9.12.0-7 on 1.100.4 and on 1.98.0: pass, `Linux slicc 6.0.0-slicc #1 SMP PREEMPT_DYNAMIC wasm32 Emscripten`. On 1.88.0 it takes the fallback branch and passes, `Emscripten emscripten 4.0.23 #1 wasm32 Emscripten`.
- published 9.12.0-6 on 1.100.4: FAIL at the first assertion, `coreutils.wasm does not import env.__syscall_uname, so no kernel can answer uname()`. With the three tarball checks switched off, the run still fails: `uname -s is Emscripten on slicc-kernel 1.100.4, which answers env.__syscall_uname (>= 1.98.0): Emscripten`.

## 9.12.0-8: 40 symlink follows (homescoop#461, 2026-10-16)

`symloop.mjs` against the published 9.12.0-7 (slicc-kernel 1.100.4, users enforce): FAIL at 40 follows, with `cat: /tmp/c40/l0: Symbolic link loop`, rc 1. The 39-link chain passes. Emscripten's `FS.lookupPath` ran 40 passes, and the first follows no link, so the 40th follow was already `ELOOP`. 9.12.0-8 is built with `scripts/emsdk-patches/libfs-symloop.patch` (41 passes; the glue has `nlinks <= 40`), and all ten specs pass on it, symloop.mjs included.

## 9.12.0-10: no DWARF, no build paths (homescoop#908; 2026-10-17)

`node scripts/check-no-debug.mjs coreutils` (host-run's #908 check) fails on the published 9.12.0-9: 1 file(s) ship 4,396,207 bytes of DWARF.

The published 9.12.0-9 also has 1 occurrence(s) of the CI build directory `/tmp/homescoop-work` in bin/coreutils.wasm (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

9.12.0-10 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 9.12.0-9 too; the negative is the #908 check.

## 9.12.0-11: posix_spawnp searches PATH (slicc-kernel#1165)

- **9.12.0-10 (the published tgz):** `cert/spawnp-path.mjs` fails its first row. `timeout 5 hs1165script` with the script first on PATH is rc 127, `timeout: failed to run command 'hs1165script': No such file or directory`. The cause is the shim's `posix_spawnp`, which was `posix_spawn`: the bare name reached the kernel, whose `proc-spawn` resolves a bare name in its catalog only. On the cert kernel the other rows pass on both versions.
- **9.12.0-11 as built:** all six rows pass (the PATH script, found past a directory of the same name earlier on PATH, `./rel/script`, the catalog `seq`, 126 for a mode-644 script, 126 for a name only a directory matches, 127 for a missing name).
- **9.12.0-11's first cut (ba20f6b9, built with `scripts/host-run.sh coreutils`):** fails the first row, `timeout 5 hs1165script rc=126 stderr=timeout: failed to run command ‘hs1165script’: Permission denied`. It spawned the first candidate that passed `access(X_OK)`, and `dbin/hs1165script` (a directory ahead of the script on PATH) passes it; the search stopped there (Codex P2 on #1264). The fix skips a candidate that isn't a regular file or isn't executable, and one whose spawn is EACCES/ENOENT/ENOTDIR, as execvp does.

## 9.12.0-11: env -i keeps Emscripten's defaults, and date ignores TZ (homescoop#612, #535)

`cert/env-tz.mjs` (`--soft`) against the published 9.12.0-11 (slicc-kernel 1.100.4, users enforce, 2026-10-20) fails 20 of its 38 assertions, for example:

```text
AssertionError [ERR_ASSERTION]: env -i FOO=1 env adds Emscripten's default USER=web_user (homescoop#612): ["USER=web_user","LOGNAME=web_user","PATH=/","PWD=/","HOME=/home/web_user","LANG=en_US.UTF-8","_=env","FOO=1","HOSTNAME=slicc"]
```

The time rows fail the same way: Emscripten's `tzset` and `localtime` read the browser's time zone and ignore `TZ`, so on a host at UTC+1 `date -u -d @0` printed `01:00:00 UTC+0100`. 9.12.0-12 passes it, and every other spec.

- **Fixes:** `slicc-env.js` builds the environment only from what the kernel passes. `slicc_tz.c` reads `TZ` on each call: POSIX rules in C, IANA names through `Intl`.
- **Where:** both are linked only into coreutils (`scripts/build-gnu-cli.sh` takes a recipe's `slicc-*.js` and `slicc_*.c`).
- **Left:** `HOSTNAME=slicc` that `env -i` still shows comes from the kernel's process environment.
