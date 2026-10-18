# Negative proof (mount)

**Date:** 2026-10-08
New package, so it needs human cert first and is not in `scripts/ci-certified.json`.

## Empty wasm

`prove-negative.mjs --package mount` → FAIL. The cert fails at the first `mount`.

## Kernel without process mounts

On `@ai-ecoverse/slicc-kernel@1.16.0` (before #92), `run.mjs --package mount` fails at the first step:

```
mount -t tmpfs: rc=32 stderr=mount: /mnt/t: mount(2) is not available (needs a slicc-kernel with process mounts).
```

This shows that the shim's ENOSYS fallback works inside the real kernel, and that the checklist can't pass without #92.

## Spec non-vacuous

`cert/checklist.mjs` asserts the exact listing lines (including `nomedium` for fsa), an empty listing of the nomedium root, "No medium found" below it (`cat`/`ls /mnt/f/x`), that the unmounted file is gone, EROFS under `-o ro`, and an error plus rc ≠ 0 for each of: bad fstype, bad option value, `/proc` target, non-mount umount, and hostfs without a hook.

## 1.0.0-4: the inherited-ignore and flock shims (homescoop#973, #947; 2026-10-17)

1.0.0-4 links the updated `shims/slicc` (#960). A `constructor(101)` in `slicc_signals.c` seeds `SIG_IGN` for each signal the kernel's `sliccKernel.sigInherited()` reports; on a kernel without the hook it changes nothing. A strong `flock()` in `slicc_libc_gaps.c` goes through the `env.__syscall_flock` import, which answers 0 without the kernel half (slicc-kernel#967 and #968). The built wasm now imports `env.slicc_sig_inherited_js`, and `env.__syscall_flock` where the program calls `flock`. The published 1.0.0-3 imports neither, so on a hooked kernel it can't see an inherited ignore, and its `flock` never conflicts. The program code is unchanged, and the specs pass on 1.0.0-3 as well. The build also gets #908's prefix maps and DWARF strip.
