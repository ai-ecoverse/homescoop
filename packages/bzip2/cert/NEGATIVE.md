# Negative proof (bzip2)

## bzip2recover aborts at EOF (published 1.0.8-1)

`checklist.mjs` on slicc-kernel 1.69.0 (Node entry, 2026-10-13). Upstream prints block offsets with `MaybeUInt64_FMT "%Lu"`, a long-double length modifier that musl's printf rejects for an integer: the call fails with errno `EINVAL`. `bsGetBit` takes any nonzero `errno` at EOF for a read error, so 1.0.8-1 prints empty offsets and gives up without writing a file:

```text
bzip2recover: searching for block boundaries ...
   block 1 runs from    block 2 runs from    block 3 runs from bzip2recover: I/O error reading `data.bz2', possible reason follows.
bzip2recover: Invalid argument
bzip2recover: warning: output file(s) may be incomplete.
```

1.0.8-2 applies `bzip2recover-llu.patch` (`"%llu"`, as Debian and Fedora do) and writes `rec00001data.bz2` … `rec00003data.bz2`.

## 1.0.8-5: the inherited-ignore and flock shims (homescoop#973, #947; 2026-10-17)

1.0.8-5 links the updated `shims/slicc` (#960). A `constructor(101)` in `slicc_signals.c` seeds `SIG_IGN` for each signal the kernel's `sliccKernel.sigInherited()` reports; on a kernel without the hook it changes nothing. A strong `flock()` in `slicc_libc_gaps.c` goes through the `env.__syscall_flock` import, which answers 0 without the kernel half (slicc-kernel#967 and #968). The built wasm now imports `env.slicc_sig_inherited_js`, and `env.__syscall_flock` where the program calls `flock`. The published 1.0.8-4 imports neither, so on a hooked kernel it can't see an inherited ignore, and its `flock` never conflicts. The program code is unchanged, and the specs pass on 1.0.8-4 as well. The build also gets #908's prefix maps and DWARF strip.

## 1.0.8-6: shim drift (homescoop#1491; 2026-10-20)

1.0.8-6 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 1.0.8-5 in `THIRD-PARTY-NOTICES.md` and `bin/bzip2`, so this is a packaging bump. The package's own code is unchanged. `THIRD-PARTY-NOTICES.md` also gains the slicc-shims section that every wasm linking the shims now carries (homescoop#1388). The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.
