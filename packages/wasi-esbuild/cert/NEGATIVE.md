# Negative proof (wasi-esbuild)

**Date:** 2026-10-09 (0.28.2-1)

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
