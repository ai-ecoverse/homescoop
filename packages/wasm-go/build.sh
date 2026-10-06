#!/usr/bin/env bash
# Go cmd/compile, cmd/link, cmd/asm → goroot/pkg/tool/wasip1_wasm/ (GO-CONTRACT).
# Mirrors slicc tmp-wasi/live/go/build.sh tools half. No slicc.commands.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasm-go

command -v go >/dev/null || { echo "missing go" >&2; exit 1; }
HOST_GO="$(go env GOVERSION)"
WANT="go${VER}"
if [[ "$HOST_GO" != "$WANT" ]]; then
  echo "homescoop: host GOVERSION is $HOST_GO but recipe wants $WANT" >&2
  exit 1
fi

OUT="$WORK/wasm-go-${VER}/goroot"
TOOL="$OUT/pkg/tool/wasip1_wasm"
mkdir -p "$TOOL"

echo "$WANT" > "$OUT/VERSION"

export GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0
for cmd in compile link asm; do
  dest="$TOOL/$cmd"
  if [[ ! -f "$dest" || -n "${FORCE:-}" ]]; then
    echo "== wasm-go: go build -trimpath -ldflags='-s -w' cmd/${cmd}"
    go build -trimpath -ldflags='-s -w' -o "$dest" "cmd/${cmd}"
  fi
  test -f "$dest"
  # no .wasm extension (contract)
  [[ "$dest" != *.wasm ]]
  ls -la "$dest"
done

DEST="$HOMESCOOP_PKG/package/goroot"
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
cp -R "$OUT" "$DEST"

if [[ -f "$(go env GOROOT)/LICENSE" ]]; then
  homescoop_stage_license "$(go env GOROOT)/LICENSE"
else
  curl -fsSL "https://raw.githubusercontent.com/golang/go/go${VER}/LICENSE" \
    -o "$HOMESCOOP_PKG/package/LICENSE"
fi

if command -v wasmtime >/dev/null 2>&1; then
  echo "== wasm-go: wasmtime smoke (compile -V)"
  out="$(wasmtime --argv0=compile "$DEST/pkg/tool/wasip1_wasm/compile" -V 2>&1 || true)"
  echo "  $out"
  echo "$out" | grep -q "version go${VER}" || {
    echo "homescoop: unexpected compile -V output" >&2
    exit 1
  }
fi

echo "== wasm-go: staged → $HOMESCOOP_PKG/package ($WANT)"
du -sh "$DEST/pkg/tool/wasip1_wasm"/*
