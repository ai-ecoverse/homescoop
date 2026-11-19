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

- **Commands:** `go build`, `go run`, `go mod download [-x]`, `go env
  [-json] [VAR...]`, `go version` and `go help`. The others (`test`, `get`,
  `install`, `list`, `vet`, `work`, `generate`, `tool`, `fmt`, `clean`,
  `doc`, `fix`, `bug`, `telemetry`), `go mod` subcommands other than
  `download`, `go env -w` and `go version -m` exit 2 and say they are not
  supported.
- **Build flags:** `-o`, `-v`, `-x`, `-a`, `-trimpath`, `-work`, `-tags`,
  `-ldflags`, `-gcflags`, `-asmflags`, `-mod`, and `-C` (first, as in go);
  `GOFLAGS` is read too. As in go, `-gcflags` and `-asmflags` without a
  pattern apply to the packages named on the command line and with `all=`
  to every package built, but never to the standard library, which is
  prebuilt (the driver says so). Other patterns, `-race`, `-cover`,
  `-msan`, `-asan`, `-linkshared`, `-n`, `-modfile`, `-overlay`, `-pgo`
  and a `-buildmode` other than `exe` exit 2.
- **Packages:** the standard library comes from an installed
  `wasm-go-std-*` package of the same Go version and target (any global
  pnpm project, or `/node_modules`); the main module's packages; and
  required modules. Those come from `vendor/` when it is there (or with
  `-mod=vendor`), else from `GOMODCACHE` (`~/go/pkg/mod`), downloaded from
  `GOPROXY` (default `https://proxy.golang.org`). See **Trust** below.
  `replace` in the main module takes a local directory or another module
  version; a dependency's `replace` is ignored, as in go. There is no
  version selection: `go.mod` must list every module that provides a
  package (what `go mod tidy` writes for a module on a current `go` line), and a dependency
  that requires a newer version than `go.mod` lists stops the build with
  "updates to go.mod needed".
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
- **Not yet:** `go.work` (refused unless `GOWORK=off`), build info in the binary (`debug.ReadBuildInfo`
  and `go version -m`), tests, and parallel compiles.

### Trust

- **Where modules come from:** `vendor/` (trusted as it is, as in go), a
  main-module `replace` directory (trusted, may be anywhere, as in go),
  or `GOMODCACHE`, filled from `GOPROXY` over `ctx.fetch`. `GOPROXY` is
  read as go reads it: a `,` moves on after a 404 or 410, a `|` after any
  error, and `off` stops. `direct` is never done, so a module that matches
  `GONOPROXY` (or `GOPRIVATE`) is not asked of any proxy and fails.
- **What is checked:** `go.sum` is the only root of trust. There is no
  checksum database (`GOSUMDB` is off; `GONOSUMDB`, `GONOSUMCHECK`,
  `GOINSECURE` and `GOFLAGS=-insecure` change nothing or are refused). A
  module with no `go.sum` line fails closed: nothing is fetched or added.
  A download's `h1:` must equal the line before anything is written, and
  the module cache records it (`.slicc-ok`), so a cached module is checked
  against each project's `go.sum` again; a cache directory this driver
  never verified is refused. `/go.mod` lines are not needed: the `go.mod`
  read is the one inside the checked zip.
- **Zips:** at most 500 MiB, packed and unpacked. Every entry must sit under
  `<module>@<version>/` without `..`, `.`, empty or control-character
  path elements or backslashes, without duplicates or case-insensitive
  collisions, and must inflate to its declared size. Entries become plain
  files (no symlinks), written to a temporary directory and renamed into
  place only when all of them are good.
- **Paths:** module paths, versions and import paths are checked as go
  checks them, so none can name a directory outside the module cache or
  its module.
- **The standard library:** the archives of any installed package whose
  `package.json` declares `slicc.go.std` for this Go version and target
  (the first one found wins), so installing a package is trusting it, as
  for any command it brings.
- **Writes:** `GOMODCACHE` (default `~/go/pkg/mod`), `GOCACHE` (default
  `~/.cache/go-build-slicc`; a hit is trusted, as in go), `TMPDIR` work
  directories (kept with `-work`), and the program at `-o` or in the
  current directory (after `-C`).

A program `go build` writes is a WASI binary that runs by path (`./prog`).
slicc-kernel gives a program run by path no root preopen, so in Go,
`os.Stat("/")` and a missing top-level path report `Bad file number`, and
the program fails from a working directory of `/` (slicc-kernel#1868). A
package that ships the binary as a command should set `"preopenRoot":
true`.

## Licence

Go is BSD-3-Clause (`LICENSE`), and Google's additional patent grant ships next to it as `PATENTS`, both from Go's source tree. Up to 1.27.2-1 the package carried `LICENSE` alone (homescoop#897).
