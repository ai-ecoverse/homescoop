# `@ai-ecoverse/wasm-go`

Go 1.26 `compile` / `link` / `asm` for wasip1/wasm — tools half of SLICC's
`go` driver (PR #3657 / GO-CONTRACT).

Layout:

```text
goroot/VERSION
goroot/pkg/tool/wasip1_wasm/{compile,link,asm}   # no .wasm suffix
```

Install with `@ai-ecoverse/wasm-go-std-wasip1` (and optionally
`…-std-linux-amd64`). Do **not** expect `compile`/`link`/`go` in
`slicc.commands` — the TS `go` supplemental owns the driver.

```bash
ipk add -g @ai-ecoverse/wasm-go @ai-ecoverse/wasm-go-std-wasip1
go version
```
