#!/usr/bin/env bash
# Builds protoc-gen-go for wasip1 as a slicc WASI package, so the end-to-end
# tests can run `buf generate` with a local plugin.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/package"
mkdir -p "$OUT/bin"
(cd "$HERE" && GOTOOLCHAIN="${GOTOOLCHAIN:-go1.26.7}" GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 \
  go build -trimpath -ldflags='-s -w' -o "$OUT/bin/protoc-gen-go.wasm" google.golang.org/protobuf/cmd/protoc-gen-go)
cat > "$OUT/package.json" <<'JSON'
{
  "name": "@ai-ecoverse/test-protoc-gen-go",
  "version": "0.0.0",
  "private": true,
  "slicc": { "abi": "wasi", "commands": { "protoc-gen-go": { "wasm": "bin/protoc-gen-go.wasm" } } }
}
JSON
