# Negative proof (util-linux)

**Date:** 2026-10-16, slicc-kernel 1.102.6 `--users enforce`.

- `prove-negative.mjs --package util-linux --spec users.mjs --users enforce`
  → FAIL (`WebAssembly.compile(): BufferSource argument is empty`; all six
  `bin/*.wasm` emptied).
- `@ai-ecoverse/wasm-util-linux@2.42.4-1` (no slicc credentials) passes
  users.mjs on 1.102.6 as well: the kernel refuses the opens itself. The spec
  guards the behaviour; host-run's `check-slicc-cred.mjs` guards the link.
  2.42.4-1 fails glue-by-path (0644 `bin/colrm`, `EACCES`).

## 2.42.4-4: the inherited-ignore and flock shims (homescoop#973, #947; 2026-10-17)

2.42.4-4 links the updated `shims/slicc` (#960). A `constructor(101)` in `slicc_signals.c` seeds `SIG_IGN` for each signal the kernel's `sliccKernel.sigInherited()` reports; on a kernel without the hook it changes nothing. A strong `flock()` in `slicc_libc_gaps.c` goes through the `env.__syscall_flock` import, which answers 0 without the kernel half (slicc-kernel#967 and #968). The built wasm now imports `env.slicc_sig_inherited_js`, and `env.__syscall_flock` where the program calls `flock`. The published 2.42.4-3 imports neither, so on a hooked kernel it can't see an inherited ignore, and its `flock` never conflicts. The program code is unchanged, and the specs pass on 2.42.4-3 as well. The build also gets #908's prefix maps and DWARF strip.
