#!/usr/bin/env bash
# esbuild for slicc WASI: the shared wasip1 Go command build (applies *.patch).
set -euo pipefail
exec "$(cd "$(dirname "$0")/../.." && pwd)/scripts/build-wasip1-go-command.sh" wasi-esbuild
