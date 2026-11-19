# `@ai-ecoverse/wasm-go`

Go 1.27 `compile` / `link` / `asm` for wasip1/wasm, and a `go` command that
drives them in slicc-kernel (`bin/go.mjs`, a JS program).

```bash
pnpm add -g @ai-ecoverse/wasm-go @ai-ecoverse/wasm-go-std-wasip1
go version                      # go version go1.27.4 wasip1/wasm
go build -o okf ./cmd/okf       # in a module: downloads, checks go.sum, builds
go run . args...
```

Layout:

```text
goroot/VERSION
goroot/pkg/include/{textflag.h,funcdata.h,asm_*.h}
goroot/pkg/tool/wasip1_wasm/{compile,link,asm}   # no .wasm suffix
```

`package.json` `slicc.go.version` is `goroot/VERSION`, and the std packages
carry the same value, so the driver pairs the toolchain and the std archives
by version.

To call `asm` yourself, pass the headers' directory, as `go build` does:
`asm -I <goroot>/pkg/include -p main -o f.o f.s`. Without `-I`, an assembly
file that starts with `#include "textflag.h"` stops at
`open textflag.h: no such file or directory`.

## The `go` command

cmd/go can't drive the toolchain in WASI (wasip1 has no processes), so
`bin/go.mjs` plans the build and runs `compile`, `link` and `asm` by path,
as cmd/go would. It is the only command the package registers; `compile`,
`link` and `asm` stay under `goroot/pkg/tool/wasip1_wasm/`.

- **Commands:** `go build`, `go run`, `go mod download`, `go env [-json]
  [VAR...]` and `go version`. Others (`test`, `get`, `install`, `list`,
  `vet`, `work`) exit 2 with "not supported by this go driver yet".
- **Build flags:** `-o`, `-v`, `-x`, `-a`, `-trimpath`, `-work`, `-tags`,
  `-ldflags`, `-gcflags`, `-mod`, `-C`; `GOFLAGS` is read too. `-race`,
  `-cover`, `-msan`, `-asan`, `-linkshared` and a `-buildmode` other than
  `exe` are refused.
- **Packages:** the standard library comes from an installed
  `wasm-go-std-*` package of the same Go version and target (any global
  pnpm project, or `/node_modules`); the main module's packages; and
  required modules. Those come from `vendor/` when it is there (or with
  `-mod=vendor`), else from `GOMODCACHE` (`~/go/pkg/mod`), downloaded from
  `GOPROXY` (default `https://proxy.golang.org`). Each zip's `h1:` hash must
  match `go.sum` before anything is extracted. A missing entry or a mismatch
  stops the build, and `direct` VCS fetches are not done. `replace` takes a
  local directory or another module version.
- **Sources:** file-name constraints (`_wasip1`, `_wasm`, `_linux_amd64`),
  `//go:build` and `// +build` lines, `//go:embed` (with `all:` and
  directories), and Go assembly (`.s`, through `asm -gensymabis`, `compile
  -symabis -asmhdr` and the objects appended to the archive). cgo is off
  (`CGO_ENABLED=0`): `import "C"` and C sources are errors.
- **Cache:** compiled archives are kept in `GOCACHE`
  (`~/.cache/go-build-slicc`), keyed by a SHA-256 of the Go version, target,
  flags, sources and dependencies. An unchanged rebuild only links.
- **Targets:** `GOOS`/`GOARCH` from the environment, `wasip1/wasm` by
  default. Another target builds when its std package is installed.
- **Not yet:** `go.work`, build info in the binary (`debug.ReadBuildInfo`
  and `go version -m`), tests, and parallel compiles.

A program `go build` writes is a WASI binary that runs by path (`./prog`).
slicc-kernel gives a program run by path no root preopen, so in Go,
`os.Stat("/")` and a missing top-level path report `Bad file number`, and
the program fails from a working directory of `/` (slicc-kernel#1868). A
package that ships the binary as a command should set `"preopenRoot":
true`.

## Licence

Go is BSD-3-Clause (`LICENSE`), and Google's additional patent grant ships next to it as `PATENTS`, both from Go's source tree. Up to 1.27.2-1 the package carried `LICENSE` alone (homescoop#897).
