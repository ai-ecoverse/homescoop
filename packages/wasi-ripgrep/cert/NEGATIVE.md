# Negative proof (wasi-ripgrep)

**Date:** 2026-10-10

## Published 15.2.0-2 (no grep-cli patch)

`cert/checklist.mjs` against `@ai-ecoverse/wasi-ripgrep@15.2.0-2` on
slicc-kernel 1.32.0 (Node entry) fails the first stdin case:
`printf 'a\nb\n' | rg b` searches the cwd instead of the pipe.

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ 'f.txt:beta\nsub/g.txt:beta two\n'
- 'b\n'
```

## 15.2.0-3 on kernels without an absent-stdin device

On slicc-kernel 1.32.0, and on slicc-kernel#195 (91dbe11), every case
passes except "no stdin": an absent stdin is an empty pipe (WASI filetype
UNKNOWN), so rg reads it and exits 1. The case needs the kernel to give
an absent stdin as a character device.
