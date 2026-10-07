# @ai-ecoverse/wasi-protoc-gen-go

[protoc-gen-go](https://pkg.go.dev/google.golang.org/protobuf/cmd/protoc-gen-go)
1.36, the Go code generator for Protocol Buffers, as a WASI preview1 command for
SLICC: `protoc-gen-go`.

It is a local plugin for [`@ai-ecoverse/wasi-buf`](https://www.npmjs.com/package/@ai-ecoverse/wasi-buf)
on `@ai-ecoverse/slicc-kernel` ≥ 1.8.0, where buf starts plugins through its
host module:

```yaml
# buf.gen.yaml
version: v2
plugins:
  - local: protoc-gen-go
    out: gen
    opt: paths=source_relative
```

`bin/protoc-gen-go.wasm` is built by homescoop from protobuf-go v1.36.12 (commit
`cdd4c5f`) with Go 1.26.7 (`GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 -trimpath`),
unchanged. SLICC's wasm realm cannot start plugins, so there buf says it needs
slicc-kernel; use a remote plugin (`remote: buf.build/protocolbuffers/go`)
instead.

BSD-3-Clause; see `LICENSE` and `THIRD-PARTY-NOTICES.md`.
