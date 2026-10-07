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
