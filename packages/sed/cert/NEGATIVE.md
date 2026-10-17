# Negative proof (sed)

**Date:** 2026-10-07  
No SLICC patches on this package.

## Empty wasm

`prove-negative.mjs --package sed` → FAIL (`WebAssembly.compile(): BufferSource argument is empty`).

## Wrong-output case (in-spec)

`cert/checklist.mjs` asserts `sed -i` rewrites the file to `beta\n` and that
`sed e` on a pattern-space shell command prints `sed-e-ok\n`.

## streams.mjs (#683)

**Date:** 2026-10-16, slicc-kernel 1.102.6 `--users enforce`.

- `prove-negative.mjs --package sed --spec streams.mjs --users enforce` → FAIL
  (`WebAssembly.compile(): BufferSource argument is empty`).
- Wrong-output cases are in-spec: the 200,000-line output is compared byte
  for byte, as are the -i.bak / w / -z / symlink / /etc/passwd results.
- 4.10.0-1 (npm) passes streams.mjs as well (no behaviour was broken, #683);
  it fails glue-by-path (0644 `bin/sed`, `EACCES`).
