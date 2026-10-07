# @ai-ecoverse/wasi-protoc-gen-connect-go

`protoc-gen-connect-go` 1.21.0, the Connect code generator for Go, as a WASI preview1 command for SLICC.

It is a local plugin for [`@ai-ecoverse/wasi-buf`](https://www.npmjs.com/package/@ai-ecoverse/wasi-buf)
on `@ai-ecoverse/slicc-kernel` ≥ 1.8.0, where buf starts plugins through its
host module:

```yaml
# buf.gen.yaml
version: v2
plugins:
  - local: protoc-gen-connect-go
    out: gen
    opt: paths=source_relative
```

`bin/protoc-gen-connect-go.wasm` is built by homescoop from connect-go v1.21.0 (commit `41b7f30`)
with Go 1.26.7 (`GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 -trimpath`), unchanged.
SLICC's wasm realm cannot start plugins, so there buf says it needs
slicc-kernel; use the remote plugin (`remote: buf.build/connectrpc/go`) instead.

Apache-2.0; see `LICENSE` and `THIRD-PARTY-NOTICES.md`.
