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

## 1.27.2-2: Go's PATENTS (homescoop#897; 2026-10-20)

`cert/licence.mjs` against the published @ai-ecoverse/wasm-go@1.27.2-1: FAIL, `PATENTS is not in the package`, and `files[]` doesn't list it. -1 staged Go's `LICENSE` alone. -2 copies `PATENTS` from the pinned `go1.27.2.src.tar.gz` too.

## 1.27.4-2: the `go` command (PR #2177; 2026-11-19)

Runs: PR #2177's CI at cb78a580, the cert job on the cert kernel slicc-kernel 1.191.2, users enforce, `scripts/browser-cert/run.mjs --spec go.mjs`. The wasm-go-std-wasip1 next to each wasm-go is the peer tarball.

- **The published 1.27.4-1** has no `slicc.commands`, so there is no `go`:
  ```
  browser-cert: FAIL packages/wasm-go/cert/go.mjs
  AssertionError [ERR_ASSERTION]: rc=127  go: command not found
  ```
- **This build with the PR's first driver** (`bin/go.mjs` replaced by bbfc9642's `src/go.mjs`, sha256 `623901656236dbb7…`): the archive cache ignored embedded file contents (#2180), so an edited asset is not compiled again:
  ```
  AssertionError [ERR_ASSERTION]: an edited embedded file is compiled again: rc=0 embed static/a.txt "hi\n" …
  ```
  The driver's other defects in that version (a module cache trusted without go.sum, module and import paths with `..`, unbounded zips, GOPRIVATE modules fetched through GOPROXY, `-asmflags` ignored, go.work ignored, no version check) fail `scripts/test/wasm-go-driver.test.mjs`: 11 of its 14 tests fail on bbfc9642's go.mjs.
- **This PR's 1.27.4-2**: go.mjs passes on 1.191.2 and on the `engines.slicc-kernel` floor, 1.88.0 (an `extra_kernels` run). On 1.85.0, 1.80.0, 1.76.0 and 1.65.0 it fails with `go: cannot run asm: EACCES`: those kernels have no chmod (no `ctx.fs.chmod` for JS programs, no `kernel.chmod`, slicc-kernel#515 in 1.88.0), so the tools keep the default modes and the driver cannot make what it links executable.
