# Negative proof (wasm-go-std-wasip1)

**Date:** 2026-10-16, on slicc-kernel 1.102.6 (the root package.json pin), users enforce. This is the package's first cert (homescoop#426). The build is this recipe's, with Go 1.26.5 from `scripts/install-go.sh`.

`prove-negative.mjs` can't corrupt this package: there's no command wasm, since the tools and archives aren't `slicc.commands`. Instead, the build's tarball with `goroot/pkg/wasip1_wasm/fmt.a` removed fails `cert/hello.mjs`:

```
browser-cert: FAIL packages/wasm-go-std-wasip1/cert/hello.mjs
AssertionError [ERR_ASSERTION]: compile: hello.go:4:2: could not import fmt (open : Invalid argument)
```

## The spec isn't vacuous

`hello.mjs` builds an importcfg from every archive `find` lists in the std package. As `cone`, it compiles `hello.go` (fmt and os) with wasm-go's `compile`, then links it with `link`:
- wasip1: the binary runs in the kernel and must print `hello from go 42 <argc>`;
- linux/amd64: the output must be a 64-bit little-endian ELF over 1 MB.

wasm-go's spec also checks `compile`, `link` and `asm -V` for `version go1.26.5`.

## 1.27.2-1: the version label (homescoop#746; 2026-10-17)

Runs: slicc-kernel 1.110.1, users enforce, `scripts/browser-cert/run.mjs`. The wasm-go next to it is 1.27.2-1, this PR's build, as the cert installs it.

- **The published 1.26.5-1** fails `hello.mjs`. Its `slicc.go.version` doesn't match the toolchain's `goroot/VERSION`, so seven's go driver would pair a 1.27.2 compile with 1.26.5 archives:
  ```
  browser-cert: FAIL packages/wasm-go-std-wasip1/cert/hello.mjs
  AssertionError [ERR_ASSERTION]: package.json slicc.go.version is the wasm-go toolchain version it pairs with (homescoop#746)
  + 'go1.26.5'
  - 'go1.27.2'
  ```
- **1.27.2-1 as Renovate's #742 first built it** (`slicc.go.version` still `go1.26.5`) fails `hello.mjs` the same way. This PR's 1.27.2-1 passes.
