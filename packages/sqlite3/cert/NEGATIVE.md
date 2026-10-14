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
