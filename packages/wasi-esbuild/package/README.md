# @ai-ecoverse/wasi-esbuild

[esbuild](https://esbuild.github.io) 0.28, the JavaScript and TypeScript
bundler, as a WASI preview1 command for SLICC: `esbuild`.

```sh
esbuild --bundle src/index.ts --outfile=out.js --format=esm --minify --sourcemap
echo 'let x: number = 1' | esbuild --loader=ts
```

`bin/esbuild.wasm` is built by homescoop from esbuild v0.28.2 with Go 1.26.7
(`GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 -trimpath`). npm's `esbuild-wasm` is a
`GOOS=js` build that needs Go's `wasm_exec.js` and a JavaScript host, which
slicc-kernel does not run as a command.

**0.28.2-2 requires slicc-kernel ≥ 1.30.0. On older kernels `--bundle` fails
entirely (`Cannot read directory "../..": Bad file number`), even for files in
the current directory; stay on 0.28.2-1 there.**

Unpatched. The command sets `"preopenRoot": true`, so slicc-kernel ≥ 1.30.0
preopens `/` and module resolution can read every directory up to the root
(`../` imports, `node_modules` and `tsconfig.json` lookups). 0.28.2-1 patched
esbuild instead and runs on older kernels.

Certified: bundling and transforms, from files and from stdin. The JS plugin
API needs a JavaScript host and is not available; `--serve` and `--watch` are
not certified.

MIT; see `LICENSE` and `THIRD-PARTY-NOTICES.md`.
