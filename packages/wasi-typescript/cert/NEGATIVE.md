# Negative proof (wasi-typescript)

**Date:** 2026-10-09 (7.0.2-1)
No SLICC patches on this package.

## Empty wasm

`bin/tsc.wasm` replaced with an empty file (what `prove-negative.mjs` does),
`cert/checklist.mjs` on slicc-kernel 1.23.0's Node entry → FAIL
(`CompileError: WebAssembly.compile(): BufferSource argument is empty`).

## Wrong-output cases (in-spec)

`cert/checklist.mjs` asserts the exact `--version` line, an empty `--noEmit`
run on a clean project, the emitted JS and declarations, and, after one return
type changes, the exact cross-file diagnostics (file, line, column, code) with
tsc's exit statuses: 1 when output is skipped, 2 when it is emitted with
errors, 1 for a missing project (TS5058). A tsc that ignored the type error,
stopped at the first file, or reported success with errors fails these
asserts.
