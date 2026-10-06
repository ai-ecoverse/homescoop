# @ai-ecoverse/wasi-buf

[buf](https://buf.build) 1.73, the Protocol Buffers CLI, as a WASI preview1
command for SLICC: `buf`. Its offline commands run on `@ai-ecoverse/slicc-kernel`
≥ 1.8.0 and in SLICC's wasm realm. On slicc-kernel, `host/buf-host.mjs` (loaded through
`slicc.commands.buf.imports`) also lets it start commands and send HTTP requests:
local protoc plugins, git inputs, HTTP inputs and the Buf Schema Registry.

`bin/buf.wasm` is built by homescoop from buf's source (v1.73.0, commit
`8b7368b`) with Go 1.26.7 (`GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 -trimpath`)
and five documented patches, so it is not an upstream buf release:

- `0001`: buf's and two modules' Unix-only files also build for wasip1.
- `0002`: `buf format -d`/`-w` print unified diffs in-process; upstream runs
  the `diff` binary, and wasip1 cannot start processes.
- `0003`: the Docker engine client is left out; only `buf beta registry plugin
  push` uses it, and it needs a Docker daemon.
- `0004`: buf's search for a workspace (`buf.yaml`, `buf.work.yaml`) walks up
  to `/`, which the WASI runtimes do not preopen; a path no preopen covers now
  ends the search.
- `0005`: starting commands, HTTP requests and buf's cache file locks go
  through the host module's `buf_host` imports. Where the host module is
  missing, those features report that this runtime cannot provide them.

Apache-2.0; see `LICENSE` and `THIRD-PARTY-NOTICES.md`.

## What works

Everywhere (slicc-kernel and SLICC's realm), everything that only reads and
writes local files:

- `buf build` (`-o image.binpb`, `--as-file-descriptor-set`), `buf export`,
  `buf ls-files`, `buf config init`
- `buf lint`, including custom check plugins built as `.wasm` (they run on
  buf's built-in wasm runtime, slowly: tens of seconds for a large plugin)
- `buf format` (`-d`, `-w`, `--exit-code`)
- `buf breaking --against` an image (`.binpb`, `.json`) or a local directory
- `buf convert` between binary, JSON and text format

On slicc-kernel, through the host module:

- `buf generate` with local plugins that are commands in the kernel (for
  example a `protoc-gen-go` built for wasip1), and with remote plugins
- inputs and `--against` from HTTP(S) URLs
- git inputs over HTTP(S): git runs as `@ai-ecoverse/wasm-git`, which must be
  installed; HTTPS remotes also need what wasm-git needs for TLS
  (`@ai-ecoverse/wasm-tls-engine` and the kernel's CA file)
- the Buf Schema Registry: `buf.build/...` modules, `buf dep update`,
  dependencies in `buf.yaml`

`buf lint`, `buf breaking` and `buf format --exit-code` exit with 100 when they
find something, as upstream buf does.

## What does not work

- In SLICC's realm, everything that needs the host module: buf says `this
  runtime cannot start commands or open network connections for buf (it needs
  slicc-kernel with @ai-ecoverse/wasi-buf's host module)`.
- Git inputs from a local `.git` directory (`file://`): wasm-git cannot start
  `git-upload-pack`. Use the repository's HTTP(S) URL.
- `buf beta registry plugin push` (needs Docker), and anything that needs a
  local Docker daemon.
- A plugin's or git's exit code reaches buf as a plain failure, not as
  `exec.ExitError`, so buf's special cases for particular codes (git's 128) do
  not apply.
