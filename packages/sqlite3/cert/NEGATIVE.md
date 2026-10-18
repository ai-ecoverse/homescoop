# Negative proof (sqlite3)

**Date:** 2026-10-14, slicc-kernel 1.81.0, on a local build of 3.54.0-1.
This is the first cert/ for sqlite3, so it isn't in `scripts/ci-certified.json`.

## Empty wasm

```
browser-cert: FAIL packages/sqlite3/cert/checklist.mjs
Error: Error: WebAssembly.compile(): BufferSource argument is empty
prove-negative: ok — cert failed on bad sqlite3 tarball (status 1)
```

## The published 3.53.4

The checklist fails at its first check against `@ai-ecoverse/wasm-sqlite3`
3.53.4:

```
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /^3\.54\.0 \d{4}-\d\d-\d\d /.
```

Every other case compares exact stdout (CSV with CRLF rows, JSON, list
mode) or exact rc and error text, so wrong output fails too. There are no
patches.

## WAL (3.54.0-2)

Against the published 3.54.0-1 (built without `SQLITE_OMIT_WAL`), the WAL
case fails: `pragma journal_mode=wal` answers `wal`, and the statements after it fail with
`Error in 2nd command line argument: disk I/O error`, rc 1. Every later open
of the file fails with `disk I/O error (10)` (homescoop#344).

## Host WAL databases (3.54.0-3)

Against the published 3.54.0-2, on slicc-kernel 1.94.0, the binary
behaves the same: `cert/host-wal.db` fails read-write and `-readonly` with
`file is not a database (26)`, rc 1. The checklist then fails at the README
check, because -2's README doesn't cover host WAL databases:

```
browser-cert: FAIL packages/sqlite3/cert/checklist.mjs
AssertionError [ERR_ASSERTION]: README: host WAL databases
  expected: /WAL-format database made on a host/,
```

## 3.54.0-6: no DWARF, no build paths (homescoop#908; 2026-10-17)

The published 3.54.0-5 also has 1 occurrence(s) of the CI build directory `/tmp/homescoop-work` in bin/sqlite3.wasm (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

3.54.0-6 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 3.54.0-5 too; the negative is the #908 check.
