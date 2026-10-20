# `@ai-ecoverse/wasm-grep`

GNU grep for slicc.

```bash
pnpm add -g @ai-ecoverse/wasm-grep
```

## 3.12.0-7: grep -P, egrep and fgrep (homescoop#680, #645; 2026-10-20)

- **`grep -P` works.** grep statically links PCRE2 10.49 (8-bit, no JIT), built from the pinned source. Its licence is in THIRD-PARTY-NOTICES.md.
- **`egrep` and `fgrep` behave as `grep -E` and `grep -F`.** Like upstream's wrapper scripts, they first print `egrep: warning: egrep is obsolescent; using grep -E` (or the fgrep equivalent) to stderr. They used to run as plain BRE grep.

