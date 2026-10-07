# @ai-ecoverse/wasi-protoc-gen-go-grpc

`protoc-gen-go-grpc` 1.6.2, the gRPC code generator for Go, as a WASI preview1 command for SLICC.

It is a local plugin for [`@ai-ecoverse/wasi-buf`](https://www.npmjs.com/package/@ai-ecoverse/wasi-buf)
on `@ai-ecoverse/slicc-kernel` ≥ 1.8.0, where buf starts plugins through its
host module:

```yaml
# buf.gen.yaml
version: v2
plugins:
  - local: protoc-gen-go-grpc
    out: gen
    opt: paths=source_relative
```

`bin/protoc-gen-go-grpc.wasm` is built by homescoop from grpc-go cmd/protoc-gen-go-grpc v1.6.2 (commit `1c63fa5`)
with Go 1.26.7 (`GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 -trimpath`), unchanged.
SLICC's wasm realm cannot start plugins, so there buf says it needs
slicc-kernel; use the remote plugin (`remote: buf.build/grpc/go`) instead.

Apache-2.0; see `LICENSE` and `THIRD-PARTY-NOTICES.md`.
