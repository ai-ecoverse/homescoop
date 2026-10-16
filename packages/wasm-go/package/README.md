# `@ai-ecoverse/wasm-go`

Go 1.27 `compile` / `link` / `asm` for wasip1/wasm — tools half of SLICC's
`go` driver (PR #3657 / GO-CONTRACT).

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

Install with `@ai-ecoverse/wasm-go-std-wasip1` (and optionally
`…-std-linux-amd64`). Do **not** expect `compile`/`link`/`go` in
`slicc.commands` — the TS `go` supplemental owns the driver.

```bash
pnpm add -g @ai-ecoverse/wasm-go @ai-ecoverse/wasm-go-std-wasip1
go version
```
