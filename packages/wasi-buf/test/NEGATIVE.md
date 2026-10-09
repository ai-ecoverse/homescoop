# Negative proof (wasi-buf 1.73.0-2)

**Date:** 2026-10-09

1.73.0-2 is built without `0004-workspace-walk-outside-preopens.patch`; the
`buf` command sets `"preopenRoot": true` instead (slicc-kernel >= 1.30.0,
slicc-kernel#144).

The same build (CI run 37988494814, `buf.wasm` sha256 `c4a06e33…`) with
`"preopenRoot": true` removed from `package/package.json`, and `e2e/*.test.mjs`
on slicc-kernel 1.30.0's Node entry: 11 of 14 tests fail, every one that
loads a module, because buf's workspace walk stats `/`, which is not preopened
without the flag.

```text
AssertionError [ERR_ASSERTION]: Failure: stat /: Bad file number
ℹ tests 14
ℹ pass 3
ℹ fail 11
```

The three that pass need no module (`--version`, `config init`, the
unreachable-registry error). With the flag the suite passes 14 of 14.
