# Negative proof (wasi-tsrs)

## 0.18.0-1

**Date:** 2026-10-20. slicc-kernel 1.132.1's Node entry, `users: enforce`,
`cert/*.mjs` against the locally built `package.tgz`. All three specs pass.
Recorded failures:

- **Empty wasm** (`bin/tsrs.wasm` emptied, what `prove-negative.mjs` does):
  `checklist.mjs` and `users.mjs` FAIL
  (`CompileError: WebAssembly.compile(): BufferSource argument is empty`).
- **Upstream's module** (`tsrs.wasm` from `@tsrs/wasm@0.18.0-ts7.1.0-dev.20260929`
  in place of ours): `checklist.mjs` FAIL
  (`tsrs: no WASI command (it exports no _start)`). `users.mjs` FAIL
  (rc 126). It is a reactor for a JS host, which is why this package
  builds its own `_start` command.
- **`cert/users.mjs` with users `off`**: FAIL. Alice type-checks bob's
  project, including his 0600 file (rc 0).

`notices.mjs` reads only `THIRD-PARTY-NOTICES.md`, so it passes in all three
cases above.

Under enforce, tsrs reports an unreadable file as missing (it never prints
its contents). It reports each output it can't write with Rust's `io::Error`
text (WASI errno 2 is EACCES):

```text
../bob/proj/src/index.ts(1,21): error TS2307: Cannot find module './secret' or its corresponding type declarations.
error TS5033: Could not write file '/home/bob/proj/out/index.js': Permission denied (os error 2).
error TS5058: The specified path does not exist: '/home/alice/proj'.
```

## Wrong-output cases (in-spec)

`cert/checklist.mjs` asserts the following:

- the exact `--version` line;
- an empty `--noEmit` run on a clean project;
- the emitted JS and declarations;
- after one return type changes, the exact cross-file diagnostics (file,
  line, column, code);
- the exit statuses that go with them.

Those statuses are TypeScript 7.1's, which native tsrs 0.18.0 shares. Errors
exit 2 with or without `--noEmit`; wasi-typescript's 7.0.2 exits 1 for
`--noEmit`. A missing project exits 1 (TS5058). A compiler that ignored the
type error, stopped at the first file, or reported success with errors
fails these asserts.

## 0.18.0-2: nested expressions (homescoop#1498, 2026-10-21)

Not a fix: the limit is documented and guarded. 0.18.0-1 type-checks up to about 815 `+` terms and 571 nested parentheses on slicc-kernel 1.134.3 (bisected), then exits 70 with `RangeError: Maximum call stack size exceeded`.

The recursion is upstream tsrs's (parser and checker), not homescoop's command crate. It runs on V8's native stack for the kernel's worker, not on the 80 MiB wasm shadow stack. Local builds at `-Os` (upstream's), `-O3`, `-Oz` and without wasm-opt reached 815–831 terms and 571–846 parentheses, so frame size isn't the lever. A deeper limit needs either a larger native stack where the kernel runs the process (asked of the Kernel Coordinator), or iterative binary-expression handling upstream. `cert/depth.mjs` passes on 0.18.0-1 too: it pins the current depth and the error, so a regression to a shallower limit or a hang fails.

