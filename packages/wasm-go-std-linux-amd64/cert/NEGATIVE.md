# Negative proof (wasm-go-std-linux-amd64)

**Date:** 2026-10-16, on slicc-kernel 1.102.6 (the root package.json pin), users enforce. This is the package's first cert (homescoop#426). The build is this recipe's, with Go 1.26.5 from `scripts/install-go.sh`.

`prove-negative.mjs` can't corrupt this package: there's no command wasm, since the tools and archives aren't `slicc.commands`. Instead, the build's tarball with `goroot/pkg/linux_amd64/fmt.a` removed fails `cert/hello.mjs`:

```
browser-cert: FAIL packages/wasm-go-std-linux-amd64/cert/hello.mjs
AssertionError [ERR_ASSERTION]: compile: hello.go:4:2: could not import fmt (open : Invalid argument)
```

## The spec isn't vacuous

`hello.mjs` builds an importcfg from every archive `find` lists in the std package. As `cone`, it compiles `hello.go` (fmt and os) with wasm-go's `compile`, then links it with `link`:
- wasip1: the binary runs in the kernel and must print `hello from go 42 <argc>`;
- linux/amd64: the output must be a 64-bit little-endian ELF over 1 MB.

wasm-go's spec also checks `compile`, `link` and `asm -V` for `version go1.26.5`.
