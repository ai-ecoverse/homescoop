# Negative proof (wasi-esbuild)

## 0.28.2-3: users enforce (#819)

**Date:** 2026-10-17. 0.28.2-3 is a CI rebuild of 0.28.2-2 (#864) with the
same source, Go and flags; the cert now boots slicc-kernel 1.102.6 with
`"users": "enforce"` and adds `cert/users.mjs`. The published 0.28.2-2
passes both specs there (the command is unchanged), so the negatives are
the setup the spec guards against and an empty wasm:

- `cert/users.mjs` on 0.28.2-2 with `--users off` (how ladder-pr ran the
  cert before this change: as root, no permission checks) → FAIL, 10 cases:
  alice bundles bob's 0600 `secret.ts` (rc 0, `stolen.js` holds
  `bob-secret-7731`), writes `/home/bob/app/dist/alice.js`, her output is
  `0:0`, and bob bundles from alice's 0700 home.
- `prove-negative.mjs --users enforce` (empty `bin/esbuild.wasm`) → FAIL,
  2 of 2 specs (`checklist.mjs`, `users.mjs`).

Under enforce the messages are esbuild's own, from the kernel's EACCES:

```text
✘ [ERROR] Cannot read file "../bob/app/src/secret.ts": Permission denied
✘ [ERROR] Failed to write to output file: open /home/bob/app/dist/alice.js: Permission denied
✘ [ERROR] Cannot read directory "../alice/src": Permission denied
```

esbuild still prints its size line and `Done` after a failed write; that is
upstream's behaviour and the exit code is 1.

## 0.28.2-2

**Date:** 2026-10-09 (0.28.2-2)

## Without "preopenRoot" (0.28.2-2, unpatched)

0.28.2-2 is the unpatched build. The same tarball with `"preopenRoot": true`
removed from the esbuild command, `cert/checklist.mjs` on slicc-kernel
1.30.0's Node entry: the first bundle case fails exactly as the unpatched
0.28.2-1 build did, because `/` is not preopened without the flag.

```text
✘ [ERROR] Cannot read directory "../..": Bad file number

✘ [ERROR] Could not resolve "./src/index.ts"
```

With the flag the same run passes every case, including the monorepo case
(`../../../shared/util`, output to `../../dist/app.js`, an absolute entry).

## 0.28.2-2 on slicc-kernel 1.29.0 (no preopenRoot support)

Older kernels ignore `"preopenRoot"`, so the unpatched build fails every
`--bundle`, even of files in the working directory (a two-file bundle in
`/home/a/b/c`, Node entry):

```text
✘ [ERROR] Cannot read directory "../../../..": Bad file number

✘ [ERROR] Could not resolve "./main.js"
```

The same bundle on 1.30.0 succeeds. Hence `engines` `slicc-kernel >=1.30.0`;
0.28.2-1 (patched) is the version for older kernels.

## 0.28.2-1 (below): the patch this replaces

## Patch reverted (0001-wasip1-outside-preopens.patch)

esbuild v0.28.2 built the same way (`GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0
-trimpath -ldflags='-s -w'`, Go 1.26) without the patch, and
`cert/checklist.mjs` run against it on slicc-kernel 1.23.0's Node entry
(`createNodeKernel`, the same WASI runtime and preopens as the page). The
bundle case fails:

```text
esbuild --bundle src/index.ts --outfile=dist/out.js --format=esm --minify --sourcemap → 1
✘ [ERROR] Cannot read directory "../..": Bad file number

✘ [ERROR] Could not resolve "./src/index.ts"
```

`../..` from `/home/app` is `/`, which slicc-kernel does not preopen. With
the patch the same run passes every case.

## Empty wasm

`bin/esbuild.wasm` replaced with an empty file (what `prove-negative.mjs`
does), `cert/checklist.mjs` on slicc-kernel 1.23.0's Node entry → FAIL
(`CompileError: WebAssembly.compile(): BufferSource argument is empty`).

## Wrong-output cases (in-spec)

The checklist asserts exact stdout for `--version` and the stdin transform,
the bundle's contents and sourcemap sources, and exit 1 with the expected
message for a syntax error and an unresolved import (with no output file).
