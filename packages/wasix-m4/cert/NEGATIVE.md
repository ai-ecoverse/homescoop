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
