#!/usr/bin/env bash
# Go cmd/compile, cmd/link, cmd/asm → goroot/pkg/tool/wasip1_wasm/ (GO-CONTRACT).
# Mirrors slicc tmp-wasi/live/go/build.sh tools half. No slicc.commands.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasm-go

eval "$(bash "$ROOT/scripts/install-go.sh" wasm-go "$WORK/go-toolchain")"
HOST_GO="$(go env GOVERSION)"
WANT="go${VER}"
if [[ "$HOST_GO" != "$WANT" ]]; then
  echo "homescoop: host GOVERSION is $HOST_GO but recipe wants $WANT" >&2
  exit 1
fi

MANIFEST_GO="$(node -p 'require(process.argv[1]).slicc.go.version' "$HOMESCOOP_PKG/package/package.json")"
if [[ "$MANIFEST_GO" != "$WANT" ]]; then
  echo "homescoop: package.json slicc.go.version is $MANIFEST_GO but recipe wants $WANT (homescoop#746)" >&2
  exit 1
fi

GO_TB="$WORK/$(basename "$SRC_URL")"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$GO_TB"
GO_SRC="$WORK/go-src-${VER}/go"
homescoop_extract "$GO_TB" "$GO_SRC"
if [[ "$(head -1 "$GO_SRC/VERSION")" != "$WANT" ]]; then
  echo "homescoop: $GO_TB VERSION is $(head -1 "$GO_SRC/VERSION"), recipe wants $WANT" >&2
  exit 1
fi
if [[ ! -x "$GO_SRC/bin/go" || -n "${FORCE:-}" ]]; then
  echo "== go: make.bash in $GO_SRC (bootstrap $(go env GOROOT))"
  (cd "$GO_SRC/src" && env -u GOOS -u GOARCH -u GOROOT PATH="/usr/bin:$PATH" GOROOT_BOOTSTRAP="$(go env GOROOT)" ./make.bash)
fi
export GOROOT="$GO_SRC" PATH="$GO_SRC/bin:$PATH"
if [[ "$(go env GOVERSION)" != "$WANT" ]]; then
  echo "homescoop: the Go built from $GO_TB says $(go env GOVERSION), recipe wants $WANT" >&2
  exit 1
fi

OUT="$WORK/wasm-go-${VER}/goroot"
TOOL="$OUT/pkg/tool/wasip1_wasm"
mkdir -p "$TOOL"

echo "$WANT" > "$OUT/VERSION"

INC="$OUT/pkg/include"
rm -rf "$INC"
mkdir -p "$INC"
cp "$GOROOT"/pkg/include/*.h "$INC/"
test -f "$INC/textflag.h"
test -f "$INC/funcdata.h"
ls -la "$INC"

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

homescoop_stage_license "$GO_SRC/LICENSE"
cp "$GO_SRC/PATENTS" "$HOMESCOOP_PKG/package/PATENTS"
grep -q '^Additional IP Rights Grant (Patents)$' "$HOMESCOOP_PKG/package/PATENTS"

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
