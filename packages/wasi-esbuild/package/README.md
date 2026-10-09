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

Unpatched. The command sets `"preopenRoot": true`, so slicc-kernel ≥ 1.30.0
preopens `/` and module resolution can read every directory up to the root
(`../` imports, `node_modules` and `tsconfig.json` lookups). On older kernels
resolution above the working directory's top-level folder fails with
`Bad file number`; 0.28.2-1 patched that instead.

Certified: bundling and transforms, from files and from stdin. The JS plugin
API needs a JavaScript host and is not available; `--serve` and `--watch` are
not certified.

MIT; see `LICENSE` and `THIRD-PARTY-NOTICES.md`.
