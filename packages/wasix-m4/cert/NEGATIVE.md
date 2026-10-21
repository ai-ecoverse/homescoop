# Negative proof (wasix-m4)

## No engines floor (1.4.20-2, #625)

`cert/checklist.mjs` against the published `@ai-ecoverse/wasix-m4@1.4.20-2` fails its first assertion:

```text
AssertionError [ERR_ASSERTION]: package.json engines.slicc-kernel (wasix-sysroot >= -20 asks the kernel for user ids): undefined
```

1.4.20-2's wasm imports `slicc.cred_*`, but the package doesn't declare the kernel it needs, so main's `check-package-meta.mjs` refused to build it. That is one of the 15 recipes in #625. 1.4.20-3 declares `>=1.44.0`.

## getlocalename-wasix.patch

Without the patch, the build fails. m4 1.4.20's gnulib `lib/getlocalename_l-unsafe.c` has branches for glibc, `__linux__` + musl, the BSDs, macOS, Solaris, Cygwin and Haiku. WASI has none of those macros, so compilation reaches:

```c
#else
 #error "Please port gnulib getlocalename_l-unsafe.c to your platform! Report this to bug-gnulib."
#endif
```

The patch adds `__wasi__` to the musl branch (`nl_langinfo_l (NL_LOCALE_NAME (category), locale)`).

## Empty wasm

`prove-negative.mjs` empties `bin/m4.wasm`. With an empty wasm every case fails, starting with `m4 --version`.

## 1.4.20-5: the description names a sysroot m4.wasm doesn't link (homescoop#862)

`cert/notices.mjs` against the published 1.4.20-5 (slicc-kernel 1.102.6, 2026-10-17) fails:

```text
browser-cert: FAIL packages/wasix-m4/cert/notices.mjs
AssertionError [ERR_ASSERTION]: package.json description names wasix-sysroot 2025.9.30-14, but m4.wasm links 2025.9.30-34
```

The same tarball with 1.4.20-6's description ("GNU m4 1.4.20 for slicc WASIX") passes `checklist.mjs` and `notices.mjs`. The notices, SOURCES.md and patch checks pass on -5 too; they guard against a later `files:` or `notices-common.sh` change dropping them.

## 1.4.20-6: the heap grows (homescoop#1287; 2026-10-21)

`cert/stress.mjs` (`--soft`) against the published 1.4.20-6 (users enforce, slicc-kernel 1.142.0) fails 3 of its 52 assertions. 1.4.20-6 links an 8.25 MiB initial memory on wasix-sysroot -34, so every workload grows the shared memory: VmSize peaks are table 17,856 kB, grow 19,136 kB and divert 17,856 kB, against the 32,768 kB that stays put. It had 0 traps in these 8 rounds; slicc-kernel#1172's trap is rare. 1.4.20-7 builds on -40, whose dlmalloc allocates from the initial pages, links `wasm.initial-memory` 32 MiB, and stays at 32,768 kB in all three workloads with 0 traps.
