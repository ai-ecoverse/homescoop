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
