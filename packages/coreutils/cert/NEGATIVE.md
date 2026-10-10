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

