# Negative proof (rsync)

**Date:** 2026-10-09
New package, so it needs human cert first and is not in `scripts/ci-certified.json`.

## Empty wasm

With `bin/rsync.wasm` truncated to 0 bytes, the checklist fails at the first
`rsync` run (slicc-kernel 1.26.4, Node entry):

```
rsync --version: rc=126 stderr=bash: line 1: /usr/bin/rsync: I/O error
```

## Without the select() wrapper

The first build linked rsync against Emscripten's own `select()`, which never
blocks (the slicc shims only replace `pselect()` and `poll()`). It copied
trees correctly, but a 3 MB `--bwlimit=500` copy finished in under a second,
so the Ctrl-C case had nothing left to interrupt (`rc=0`, not 20), and the
`--bwlimit` case fails its ≥ 1.5 s bound. `slicc_rsync_select.c` maps
`select()` to the shim's `pselect()`; with it both cases pass.

## Spec non-vacuous

`cert/checklist.mjs` compares the exact `--itemize-changes` lines of a fresh
copy, snapshots path, mode, mtime and md5 of every entry in source and
destination, reads `--stats` transfer counts, checks that `--dry-run` leaves
the destination untouched, that `-c` changes the outcome of an equal
size-and-mtime pair, exact exit codes (23 for a missing source, 20 for SIGINT)
and that no `rsync` process survives an interrupt.
