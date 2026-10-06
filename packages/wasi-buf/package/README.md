# @ai-ecoverse/wasi-buf

[buf](https://buf.build) 1.73, the Protocol Buffers CLI, as a WASI preview1
command for SLICC: `buf`. It runs on `@ai-ecoverse/slicc-kernel` ≥ 1.7.2 and in
SLICC's wasm realm, and needs nothing from them beyond WASI preview1.

`bin/buf.wasm` is built by homescoop from buf's source (v1.73.0, commit
`8b7368b`) with Go 1.26.7 (`GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 -trimpath`)
and four documented patches, so it is not an upstream buf release:

- `0001`: buf's and two modules' Unix-only files also build for wasip1.
- `0002`: `buf format -d`/`-w` print unified diffs in-process; upstream runs
  the `diff` binary, and wasip1 cannot start processes.
- `0003`: the Docker engine client is left out; only `buf beta registry plugin
  push` uses it, and it needs a Docker daemon.
- `0004`: buf's search for a workspace (`buf.yaml`, `buf.work.yaml`) walks up
  to `/`, which the WASI runtimes do not preopen; a path no preopen covers now
  ends the search.

Apache-2.0; see `LICENSE` and `THIRD-PARTY-NOTICES.md`.

## What works

Everything that only reads and writes local files:

- `buf build` (`-o image.binpb`, `--as-file-descriptor-set`), `buf export`,
  `buf ls-files`, `buf config init`
- `buf lint`, including custom check plugins built as `.wasm` (they run on
  buf's built-in wasm runtime, slowly: tens of seconds for a large plugin)
- `buf format` (`-d`, `-w`, `--exit-code`)
- `buf breaking --against` an image (`.binpb`, `.json`) or a local directory
- `buf convert` between binary, JSON and text format

`buf lint`, `buf breaking` and `buf format --exit-code` exit with 100 when they
find something, as upstream buf does.

## What does not work yet

- `buf generate` with local plugins (`protoc-gen-*`): starting another process
  is not possible from wasip1. It fails with `exec: "protoc-gen-…": executable
  file not found in $PATH`.
- Git inputs (`.git#branch=main`): buf runs `git`, same error.
- The Buf Schema Registry: `buf.build/...` inputs, `buf dep update` with
  dependencies, remote plugins, `buf push`. Go's wasip1 port cannot open
  network connections; buf reports `the server hosted at that remote is
  unavailable`.
