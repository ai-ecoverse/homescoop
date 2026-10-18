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
