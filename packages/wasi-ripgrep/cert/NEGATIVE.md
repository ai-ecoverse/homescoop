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

## 15.2.0-3 on a kernel without the null-stdin device

On slicc-kernel 1.32.0 (before slicc-kernel#209), an absent stdin is an empty
pipe (WASI filetype UNKNOWN), so rg reads it and the "no stdin" case fails:

```text
AssertionError [ERR_ASSERTION]: no stdin rc=1 stderr=
```

On 1.34.1 an absent stdin and `< /dev/null` are the null character device
(filetype 2), rg searches the cwd, and every case passes.

## THIRD-PARTY-NOTICES.md names the wrong wasi-sdk (15.2.0-4, homescoop#472)

`cert/notices.mjs` against the published `@ai-ecoverse/wasi-ripgrep@15.2.0-4` on
slicc-kernel 1.34.1:

```text
browser-cert: FAIL packages/wasi-ripgrep/cert/notices.mjs
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+   "## wasi-libc (wasi-sdk-31; Rust's self-contained wasm32-wasip1 libc)"
-   "## wasi-libc (wasi-sdk-33; Rust's self-contained wasm32-wasip1 libc)"
```

Rust 1.98.1 builds its self-contained wasm32-wasip1 libc with
`WASI_SDK_PATH=/tmp/wasi-sdk-33.0-x86_64-linux`. The four licence files are
the same at both tags, so only the heading and the URLs were wrong.
`scripts/check-rust-wasi-sdk.mjs` now checks the table against that
Dockerfile on every build.
