# Negative proof (coreutils)

**Date:** 2026-10-07

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
