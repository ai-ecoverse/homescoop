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
- `object-array-rvalue.patch`: without it, `poppler/Annot.cc` and others fail
  to compile under emsdk 4.0.23 (`invalid application of 'sizeof' to an
  incomplete type 'Array'`).
