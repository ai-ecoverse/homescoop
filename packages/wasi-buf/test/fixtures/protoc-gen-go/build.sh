#!/usr/bin/env bash
# Builds protoc-gen-go for wasip1 as a slicc WASI package, so the end-to-end
# tests can run `buf generate` with a local plugin.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../../.." && pwd)"
export HOMESCOOP_ROOT="$ROOT"
source "$ROOT/scripts/build-common.sh"
field () { node "$ROOT/scripts/read-recipe.mjs" wasi-buf --field "$1"; }
GO_VERSION="$(field toolchain.go)"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) go_arch=linux-amd64; host=linux_x64 ;;
  Darwin-arm64) go_arch=darwin-arm64; host=macos_arm64 ;;
  *) echo "homescoop: no Go toolchain pin for $(uname -sm)" >&2; exit 1 ;;
esac
TOOLS="$WORK/wasi-buf-test-tools"
mkdir -p "$TOOLS"
GO_TGZ="$TOOLS/go$GO_VERSION.$go_arch.tar.gz"
homescoop_fetch "https://go.dev/dl/go$GO_VERSION.$go_arch.tar.gz" "$(field "toolchain.go_sha256_$host")" "$GO_TGZ"
GOROOT_DIR="$TOOLS/go$GO_VERSION.$go_arch"
if [[ ! -x "$GOROOT_DIR/bin/go" ]]; then
  rm -rf "$GOROOT_DIR"
  mkdir -p "$GOROOT_DIR"
  tar -xzf "$GO_TGZ" -C "$GOROOT_DIR" --strip-components=1
fi
OUT="$HERE/package"
mkdir -p "$OUT/bin"
(cd "$HERE" && PATH="$GOROOT_DIR/bin:$PATH" GOTOOLCHAIN=local GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 \
  go build -trimpath -ldflags='-s -w' -o "$OUT/bin/protoc-gen-go.wasm" google.golang.org/protobuf/cmd/protoc-gen-go)
cat > "$OUT/package.json" <<'JSON'
{
  "name": "@ai-ecoverse/test-protoc-gen-go",
  "version": "0.0.0",
  "private": true,
  "slicc": { "abi": "wasi", "commands": { "protoc-gen-go": { "wasm": "bin/protoc-gen-go.wasm" } } }
}
JSON
