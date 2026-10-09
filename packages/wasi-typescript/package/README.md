# @ai-ecoverse/wasi-typescript

[TypeScript](https://www.typescriptlang.org) 7, the native compiler that
`typescript@7` ships, as a WASI preview1 command for SLICC: `tsc`.

```sh
tsc --noEmit -p .   # type-check the project in tsconfig.json
tsc -p .            # and emit
```

`bin/tsc.wasm` is `cmd/tsgo` from microsoft/typescript-go `typescript/v7.0.2`,
built by homescoop with Go 1.26.7 (`GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0
-trimpath`), unchanged. The `lib.*.d.ts` files are embedded in it, so it needs
no `node_modules/typescript`; `@types/*` packages resolve from the project's
`node_modules` as usual.

Certified: project type checking with cross-file errors, emit (JS and
declarations), and `--version`. `--watch`, `--build` and the language server
are not certified.

Apache-2.0; see `LICENSE`, `NOTICE` and `THIRD-PARTY-NOTICES.md`.
