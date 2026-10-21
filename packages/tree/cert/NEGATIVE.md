# Negative proof (tree)

## Empty wasm

**Date:** 2026-10-16, slicc-kernel 1.102.6 `--users enforce`.
`prove-negative.mjs --package tree --spec users.mjs --users enforce` → FAIL
(`WebAssembly.compile(): BufferSource argument is empty`).

## users.mjs: -u owner names (#824)

`@ai-ecoverse/wasm-tree@2.3.2-2` (no `homescoop_slicc_wrap_pwd`, so
Emscripten's getpwuid stub answers "not found") fails users.mjs:

```
AssertionError [ERR_ASSERTION]: root: tree -pug names the owner (#824)
  '[drwxr-xr-x 0        root    ]  /tmp/tu' !== '[drwxr-xr-x root     root    ]  /tmp/tu'
```

Its permission cases pass on 1.102.6 (and so do 2.3.2-1's): the kernel
refuses the directories itself. 2.3.2-1 fails glue-by-path (0644 `bin/tree`).

## 2.3.2-5: the inherited-ignore and flock shims (homescoop#973, #947; 2026-10-17)

2.3.2-5 links the updated `shims/slicc` (#960). A `constructor(101)` in `slicc_signals.c` seeds `SIG_IGN` for each signal the kernel's `sliccKernel.sigInherited()` reports; on a kernel without the hook it changes nothing. A strong `flock()` in `slicc_libc_gaps.c` goes through the `env.__syscall_flock` import, which answers 0 without the kernel half (slicc-kernel#967 and #968). The built wasm now imports `env.slicc_sig_inherited_js`, and `env.__syscall_flock` where the program calls `flock`. The published 2.3.2-4 imports neither, so on a hooked kernel it can't see an inherited ignore, and its `flock` never conflicts. The program code is unchanged, and the specs pass on 2.3.2-4 as well. The build also gets #908's prefix maps and DWARF strip.

## 2.3.2-6: no stale kernel line (homescoop#847; 2026-10-20)

There's no behaviour change, so there's no failing negative to show. The README dropped `Certified on @ai-ecoverse/slicc-kernel 1.23.0`, while `cert/meta.json` says 1.102.6. `scripts/test/readme-cert-kernel.test.mjs` now checks every package with no STALE exceptions left.

## 2.3.2-7: shim drift (homescoop#1491; 2026-10-21)

2.3.2-7 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 2.3.2-6 in `bin/tree`, so this is a packaging bump. The package's own code is unchanged. The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.
