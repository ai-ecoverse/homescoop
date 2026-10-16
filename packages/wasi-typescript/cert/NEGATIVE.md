# Negative proof (wasi-typescript)

## 7.0.2-2: users enforce (#819)

**Date:** 2026-10-17. 7.0.2-2 is a CI rebuild of 7.0.2-1 (#864) with the
same source, Go and flags; the cert now boots slicc-kernel 1.102.6 (was
1.23.0) with `"users": "enforce"` and adds `cert/users.mjs`. The published
7.0.2-1 passes both specs there (the command is unchanged), so the
negatives are the setup the spec guards against and an empty wasm:

- `cert/users.mjs` on 7.0.2-1 with `--users off` (how ladder-pr ran the
  cert before this change: as root, no permission checks) → FAIL, 8 cases:
  alice type-checks bob's project including his 0600 file (rc 0), emits
  into `/home/bob/proj/out`, every output is `0:0`, and bob checks alice's
  0700 home.
- `prove-negative.mjs --users enforce` (empty `bin/tsc.wasm`) → FAIL,
  2 of 2 specs (`checklist.mjs`, `users.mjs`).

Under enforce, tsc reports an unreadable file as missing (it never prints
its contents) and an unwritable output with the kernel's EACCES:

```text
../bob/proj/src/index.ts(1,21): error TS2307: Cannot find module './secret' or its corresponding type declarations.
error TS5033: Could not write file '/home/bob/proj/out/index.js': mkdir /home/bob/proj/out: Permission denied.
error TS5058: The specified path does not exist: '/home/alice/proj'.
```

## 7.0.2-1

**Date:** 2026-10-09 (7.0.2-1)
No SLICC patches on this package.

## Empty wasm

`bin/tsc.wasm` replaced with an empty file (what `prove-negative.mjs` does),
`cert/checklist.mjs` on slicc-kernel 1.23.0's Node entry → FAIL
(`CompileError: WebAssembly.compile(): BufferSource argument is empty`).

## Wrong-output cases (in-spec)

`cert/checklist.mjs` asserts the exact `--version` line, an empty `--noEmit`
run on a clean project, the emitted JS and declarations, and, after one return
type changes, the exact cross-file diagnostics (file, line, column, code) with
tsc's exit statuses: 1 when output is skipped, 2 when it is emitted with
errors, 1 for a missing project (TS5058). A tsc that ignored the type error,
stopped at the first file, or reported success with errors fails these
asserts.
