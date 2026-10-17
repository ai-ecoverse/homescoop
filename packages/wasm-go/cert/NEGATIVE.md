# Negative proof (wasm-go)

**Date:** 2026-10-16, on slicc-kernel 1.102.6 (the root package.json pin), users enforce. This is the package's first cert (homescoop#426). The build is this recipe's, with Go 1.26.5 from `scripts/install-go.sh`.

`prove-negative.mjs` can't corrupt this package: there's no command wasm, since the tools and archives aren't `slicc.commands`. Instead, the build's tarball with `goroot/pkg/tool/wasip1_wasm/compile` emptied fails `cert/hello.mjs`:

```
browser-cert: FAIL packages/wasm-go/cert/hello.mjs
AssertionError [ERR_ASSERTION]: compile -V: /node_modules/@ai-ecoverse/wasm-go/goroot/pkg/tool/wasip1_wasm/compile: command not found
```

## The spec isn't vacuous

`hello.mjs` builds an importcfg from every archive `find` lists in the std package. As `cone`, it compiles `hello.go` (fmt and os) with wasm-go's `compile`, then links it with `link`:
- wasip1: the binary runs in the kernel and must print `hello from go 42 <argc>`;
- linux/amd64: the output must be a 64-bit little-endian ELF over 1 MB.

wasm-go's spec also checks `compile`, `link` and `asm -V` for `version go1.26.5`.

## 1.27.2-1: the version label and the assembler headers (homescoop#746, #747; 2026-10-17)

Runs: slicc-kernel 1.110.1, users enforce, `scripts/browser-cert/run.mjs`, the specs as in this PR. The wasm-go-std-wasip1 next to each wasm-go is the matching one.

- **The published 1.26.5-2**, with std 1.26.5-1: `hello.mjs` passes. `asm.mjs` fails, because the package has no `goroot/pkg/include`:
  ```
  browser-cert: FAIL packages/wasm-go/cert/asm.mjs
  AssertionError [ERR_ASSERTION]: goroot/pkg/include: find: '/node_modules/@ai-ecoverse/wasm-go/goroot/pkg/include': No such file or directory
  ```
- **1.27.2-1 as Renovate's #742 first built it**: this build, with `slicc.go.version` put back to `go1.26.5`. `asm.mjs` passes. `hello.mjs` fails:
  ```
  browser-cert: FAIL packages/wasm-go/cert/hello.mjs
  AssertionError [ERR_ASSERTION]: package.json slicc.go.version is goroot/VERSION (homescoop#746)
  ```
- **This PR's 1.27.2-1**, with std 1.27.2-1: both specs pass. `asm.mjs` checks four things. Without `-I` the assembler can't open `textflag.h`, which is upstream Go's behaviour too: `go build` passes `-I $GOROOT/pkg/include`. With `-I goroot/pkg/include`, `-gensymabis` and the object assemble. `compile -symabis` takes the declaration. The object is appended to main's archive, and the linked program prints `asm says 42`.
