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
- linux/amd64: the output, read back byte-exact with `ctx.readBytes`, must be a 64-bit little-endian x86-64 executable ELF over 1 MB whose PT_LOAD segments lie inside the file and whose entry point falls in an executable one. On a linux/amd64 host it must run and print `hello from go 42 1`.

Before homescoop#738 the spec read the ELF with `ctx.read`, which decodes UTF-8: the header bytes are ASCII, so it passed, but the bytes came back as 2,642,048 instead of 2,675,813 and segfaulted on a linux/amd64 host. The same spec on that read path (`Buffer.from(await ctx.read(…), 'latin1')`) now fails (slicc-kernel 1.102.6, users enforce, 1.26.5-1 from npm, 2026-10-16):

```
browser-cert: FAIL packages/wasm-go-std-linux-amd64/cert/hello.mjs
AssertionError [ERR_ASSERTION]: PT_LOAD 2 (654592+72057594037931265) lies inside the 1981749-byte file
```

wasm-go's spec also checks `compile`, `link` and `asm -V` for `version go1.26.5`.

## 1.27.2-1: the version label (homescoop#746; 2026-10-17)

Runs: slicc-kernel 1.110.1, users enforce, `scripts/browser-cert/run.mjs`. The wasm-go next to it is 1.27.2-1, this PR's build, as the cert installs it.

- **The published 1.26.5-1** fails `hello.mjs`. Its `slicc.go.version` doesn't match the toolchain's `goroot/VERSION`, so seven's go driver would pair a 1.27.2 compile with 1.26.5 archives:
  ```
  browser-cert: FAIL packages/wasm-go-std-linux-amd64/cert/hello.mjs
  AssertionError [ERR_ASSERTION]: package.json slicc.go.version is the wasm-go toolchain version it pairs with (homescoop#746)
  + 'go1.26.5'
  - 'go1.27.2'
  ```
- This PR's 1.27.2-1 passes: the ELF links and the label is `go1.27.2`.
