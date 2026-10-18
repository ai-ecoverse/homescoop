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

## 4.10.0-4: no DWARF, no build paths (homescoop#908; 2026-10-17)

`node scripts/check-no-debug.mjs sed` (host-run's #908 check) fails on the published 4.10.0-3: 1 file(s) ship 874,324 bytes of DWARF.

The published 4.10.0-3 also has 1 occurrence(s) of the CI build directory `/tmp/homescoop-work` in bin/sed.wasm (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

4.10.0-4 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 4.10.0-3 too; the negative is the #908 check.
