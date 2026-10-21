# Negative proof (grep)

**Date:** 2026-10-07

## Empty wasm (spec not vacuous)

`prove-negative.mjs --package grep` → FAIL (`WebAssembly.compile(): BufferSource argument is empty`).

## Patch reverted (gnulib-emscripten-locale.patch)

Remove `packages/grep/gnulib-emscripten-locale.patch` and run `bash scripts/host-run.sh grep`
(2026-10-07, homescoop worktree).

**Result:** compile fails:

```text
getlocalename_l-unsafe.c:661:3: error: "Please port gnulib getlocalename_l-unsafe.c to your platform! Report this to bug-gnulib."
gmake[4]: *** [Makefile:6769: getlocalename_l-unsafe.o] Error 1
```

**Good tarball:** `@ai-ecoverse/wasm-grep@3.12.0-3` — `cert/checklist.mjs` passes
(match, no-match exit 1, `LC_ALL=C` grep).

## 3.12.0-6: no DWARF, no build paths (homescoop#908; 2026-10-17)

`node scripts/check-no-debug.mjs grep` (host-run's #908 check) fails on the published 3.12.0-5: 1 file(s) ship 963,454 bytes of DWARF.

The published 3.12.0-5 also has 2 occurrence(s) of the CI build directory `/tmp/homescoop-work` in bin/grep.wasm (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

3.12.0-6 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 3.12.0-5 too; the negative is the #908 check.

## 3.12.0-7: grep -P, egrep and fgrep (homescoop#680, #645; 2026-10-20)

The `@ai-ecoverse/wasm-grep@3.12.0-6` tarball from npm, slicc-kernel 1.132.1, users enforce:

- `cert/perl-regexp.mjs`: FAIL. `grep -P \d p.txt` gives `grep: Perl matching not supported in a --disable-perl-regexp build`, rc 2.
- `cert/egrep-fgrep.mjs`: FAIL. `egrep 'a|z' e.txt` prints nothing with rc 1, because it ran as BRE grep.

This branch's build passes both, plus checklist.mjs, on the same kernel.

## 3.12.0-8: shim drift (homescoop#1491; 2026-10-20)

3.12.0-8 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 3.12.0-7 in `bin/grep` and `bin/grep.wasm`, so this is a packaging bump. The package's own code is unchanged. The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.
