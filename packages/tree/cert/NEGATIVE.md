# Negative proof (tree)

## Empty wasm

**Date:** 2026-10-16, slicc-kernel 1.102.6 `--users enforce`.
`prove-negative.mjs --package tree --spec users.mjs --users enforce` → FAIL
(`WebAssembly.compile(): BufferSource argument is empty`).

## users.mjs: -u owner names (#824)

`@ai-ecoverse/wasm-tree@2.3.2-2` (no `homescoop_slicc_wrap_pwd`, so
Emscripten's getpwuid stub answers "not found") fails users.mjs:

```
AssertionError [ERR_ASSERTION]: root: tree -pug names the owner (#824)
  '[drwxr-xr-x 0        root    ]  /tmp/tu' !== '[drwxr-xr-x root     root    ]  /tmp/tu'
```

Its permission cases pass on 1.102.6 (and so do 2.3.2-1's): the kernel
refuses the directories itself. 2.3.2-1 fails glue-by-path (0644 `bin/tree`).
