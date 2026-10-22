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

## 3.54.0-7: shim drift (homescoop#1491; 2026-10-20)

3.54.0-7 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 3.54.0-6 in `THIRD-PARTY-NOTICES.md`, `bin/sqlite3` and `bin/sqlite3.wasm`, so this is a packaging bump. The package's own code is unchanged. `THIRD-PARTY-NOTICES.md` also gains the slicc-shims section that every wasm linking the shims now carries (homescoop#1388). The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.

## 3.54.0-8: locks across processes and tabs (homescoop#762, #952, #1215; 2026-10-22)

The README replaces "Use one process per database at a time" with the lock floors: cross-process locks on slicc-kernel 1.100.0 or later (homescoop#513), cross-tab locks since 1.119.0 (slicc-kernel#944), coherent cross-tab writes since 1.120.1 (slicc-kernel#949) and cross-tab opens since 1.122.3 (slicc-kernel#950), with one process per database on older kernels. The binary is unchanged. Run locally on slicc-kernel 1.143.5, users enforce, with wasm-bash 5.3.0-22, wasm-coreutils 9.12.0-12 and wasix-python 3.15.0-4.

Against the published 3.54.0-7, the checklist fails at the README check; `locks.mjs` and `users.mjs` pass, since the binary is the same:

```
browser-cert: FAIL packages/sqlite3/cert/checklist.mjs
AssertionError [ERR_ASSERTION]: README: cross-process locks (homescoop#762)
  expected: /SQLite's file locks work between processes/,
cert-run: FAIL sqlite3 fail
```

`locks.mjs` with wasix-python 3.14.2-21 (before python's locks went through the kernel) fails at its first race: python's insert goes through while the CLI holds `begin immediate`, and the CLI's commit then fails, so its row is lost. This is homescoop#513's data:

```
a-held
a-running
b=0
a-still-running
a=1
--- a
Error near line 4: disk I/O error
--- b
py-inserted py-try
```

`users.mjs` (homescoop#1215) is coverage: it also holds on 3.54.0-7.
