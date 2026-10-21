# Negative proof (gzip)

**Date:** 2026-10-07  
No SLICC patches on this package.

## Empty wasm

`prove-negative.mjs --package gzip` → FAIL (`WebAssembly.compile(): BufferSource argument is empty`).

## Wrong-output case (in-spec)

`cert/checklist.mjs` asserts gunzip/zcat round-trip bytes and that corrupt
input exits non-zero.

## 1.15.0-5: the inherited-ignore and flock shims (homescoop#973, #947; 2026-10-17)

1.15.0-5 links the updated `shims/slicc` (#960). A `constructor(101)` in `slicc_signals.c` seeds `SIG_IGN` for each signal the kernel's `sliccKernel.sigInherited()` reports; on a kernel without the hook it changes nothing. A strong `flock()` in `slicc_libc_gaps.c` goes through the `env.__syscall_flock` import, which answers 0 without the kernel half (slicc-kernel#967 and #968). The built wasm now imports `env.slicc_sig_inherited_js`, and `env.__syscall_flock` where the program calls `flock`. The published 1.15.0-4 imports neither, so on a hooked kernel it can't see an inherited ignore, and its `flock` never conflicts. The program code is unchanged, and the specs pass on 1.15.0-4 as well. The build also gets #908's prefix maps and DWARF strip.

## 1.15.0-6: shim drift (homescoop#1491; 2026-10-20)

1.15.0-6 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 1.15.0-5 in `THIRD-PARTY-NOTICES.md` and `bin/gzip`, so this is a packaging bump. The package's own code is unchanged. `THIRD-PARTY-NOTICES.md` also gains the slicc-shims section that every wasm linking the shims now carries (homescoop#1388). The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.
