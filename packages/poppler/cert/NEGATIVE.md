# Negative proof (poppler)

**Date:** 2026-10-09
New package, so it needs human cert first and is not in `scripts/ci-certified.json`.

## Empty wasm

With `bin/poppler-multicall.wasm` truncated to 0 bytes, the checklist fails at
the first command (slicc-kernel 1.23.0, Node entry):

```
CompileError: WebAssembly.compile(): BufferSource argument is empty
```

## Patches

- `fontsdir-env.patch`: the cert runs the same render with
  `POPPLER_FONTSDIR=/nonexistent`, which is what an unpatched build sees
  (the generic font configuration has no font directory at all). It prints
  `No display font for 'Helvetica'` and draws less ink. The checklist
  requires that state *not* to occur with the package's own environment.
- `multicall.patch`: the first version of the dispatcher read the -1 that
  `pdfunite` returns on error as "unknown util" and printed the multi-call
  usage, rc 99. The last error case caught it, and it is now asserted.
  The pdftocairo hint (26.10.0-2): the published 26.10.0-1, which runs
  pdftocairo as plain pdftoppm, fails the `-svg` case, because pdftoppm's
  usage comes first instead of the hint.
- `object-array-rvalue.patch`: without it, `poppler/Annot.cc` and others fail
  to compile under emsdk 4.0.23 (`invalid application of 'sizeof' to an
  incomplete type 'Array'`).

## 26.10.0-4: attested build inputs (homescoop#864; 2026-10-17)

26.10.0-4 changes only the build inputs:
- wasm-zlib 1.3.1-4, was the unattested 1.3.1-2;
- wasm-libjpeg-turbo 3.1.2-4, was 3.1.2-3;
- wasm-libpng 1.6.59-3, was 1.6.59-2, which links zlib 1.3.1-2;
- wasm-lcms2 2.19.1-3, was 2.19.1-2, which links zlib 1.3.1-2.

FreeType 2.13.3-3 and OpenJPEG 2.5.3-1 were already attested latests. The upstream versions behind every input are the same, so the THIRD-PARTY-NOTICES text is unchanged. The cert kernel moves from 1.23.0 to 1.110.1 (certified), and the pins move to bash 5.3.0-19 and coreutils 9.12.0-9.

The poppler code is unchanged, so the published 26.10.0-3 passes `checklist.mjs` too, and the negatives above still stand. This build passes `checklist.mjs` and glue by path on 1.110.1 under users enforce: darwin-arm64, through slicc-heavy.

## 26.10.0-5: the inherited-ignore and flock shims (homescoop#973, #947; 2026-10-17)

26.10.0-5 links the updated `shims/slicc` (#960). A `constructor(101)` in `slicc_signals.c` seeds `SIG_IGN` for each signal the kernel's `sliccKernel.sigInherited()` reports; on a kernel without the hook it changes nothing. A strong `flock()` in `slicc_libc_gaps.c` goes through the `env.__syscall_flock` import, which answers 0 without the kernel half (slicc-kernel#967 and #968). The built wasm now imports `env.slicc_sig_inherited_js`, and `env.__syscall_flock` where the program calls `flock`. The published 26.10.0-4 imports neither, so on a hooked kernel it can't see an inherited ignore, and its `flock` never conflicts. The program code is unchanged, and the specs pass on 26.10.0-4 as well. The build also gets #908's prefix maps and DWARF strip.
