# `@ai-ecoverse/wasm-go-std-wasip1`

Go 1.26 standard-library export archives for `wasip1/wasm`.

```text
goroot/pkg/wasip1_wasm/<import path>.a
```

Tools-free: declares `slicc.go.std` only. Pair with `@ai-ecoverse/wasm-go`.
Split from the tools package because one target's std is ~30 MB gzipped
(over the 40 MiB npm cap when combined with tools).
