# Negative proof (xxd)

**Date:** 2026-10-07  
No SLICC patches on this package.

## Empty wasm

`prove-negative.mjs --package xxd` → FAIL (`WebAssembly.compile(): BufferSource argument is empty`).

## Wrong-output case (in-spec)

`cert/roundtrip.mjs` requires `xxd | xxd -r` to restore the original bytes
(`AB\n`). A no-op or truncated dump would fail the equality assert.

## 9.2.1192-3: the inherited-ignore and flock shims (homescoop#973, #947; 2026-10-17)

9.2.1192-3 links the updated `shims/slicc` (#960). A `constructor(101)` in `slicc_signals.c` seeds `SIG_IGN` for each signal the kernel's `sliccKernel.sigInherited()` reports; on a kernel without the hook it changes nothing. A strong `flock()` in `slicc_libc_gaps.c` goes through the `env.__syscall_flock` import, which answers 0 without the kernel half (slicc-kernel#967 and #968). The built wasm now imports `env.slicc_sig_inherited_js`, and `env.__syscall_flock` where the program calls `flock`. The published 9.2.1192-2 imports neither, so on a hooked kernel it can't see an inherited ignore, and its `flock` never conflicts. The program code is unchanged, and the specs pass on 9.2.1192-2 as well. The build also gets #908's prefix maps and DWARF strip.
