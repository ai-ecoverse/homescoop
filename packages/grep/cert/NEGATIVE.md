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
