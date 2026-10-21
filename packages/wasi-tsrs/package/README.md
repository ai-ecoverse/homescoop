# @ai-ecoverse/wasi-tsrs

[tsrs](https://github.com/oxc-project/tsrs), the Rust port of the TypeScript 7
compiler, as a WASI preview1 command for SLICC: `tsrs`, which takes `tsc`'s
arguments.

```sh
tsrs --noEmit -p .   # type-check the project in tsconfig.json
tsrs -p .            # and emit
```

`bin/tsrs.wasm` is native tsrs's `tsc` driver from oxc-project/tsrs `v0.18.0`
(TypeScript `7.1.0-dev`), built by homescoop for `wasm32-wasip1` with Rust
1.99.1 and no changes to tsrs: a small command crate runs it over the file
system. The `lib.*.d.ts` files are embedded, so it needs no
`node_modules/typescript`; `@types/*` packages resolve from the project's
`node_modules` as usual. It runs on one thread.

tsrs follows TypeScript 7.1: type errors with `--noEmit` exit with status 2,
where TypeScript 7.0 (`@ai-ecoverse/wasi-typescript`) exits with 1.

Certified: project type checking with cross-file errors, emit (JS and
declarations), `--version`, and file permissions under slicc-kernel users.
`--watch`, `--build`, `--lsp` and `--api` are not certified.

**Deeply nested expressions** (homescoop#1498): tsrs's parser and checker
recurse once per level of a nested expression. In a browser, that recursion
runs on the worker's native call stack (about 1 MB in V8), not on tsrs's
80 MiB wasm stack, so a chain of more than about 800 `+` terms, or more than
about 550 nested parentheses, ends with `RangeError: Maximum call stack size
exceeded` (exit 70). Hand-written code doesn't get near that; generated
code (large string tables) can. Split such an expression into parts. The
depth barely moves with the build's optimization level (measured: 815–831
terms and 571–846 parentheses across `-Os`, `-O3`, `-Oz` and no wasm-opt).

Apache-2.0; see `LICENSE`, `NOTICE` and `THIRD-PARTY-NOTICES.md`.
