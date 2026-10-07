#!/usr/bin/env bash
# protoc-gen-go-grpc for slicc WASI: the shared wasip1 Go command build.
set -euo pipefail
exec "$(cd "$(dirname "$0")/../.." && pwd)/scripts/build-wasip1-go-command.sh" wasi-protoc-gen-go-grpc
