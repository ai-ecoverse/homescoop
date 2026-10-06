#!/usr/bin/env bash
# Go std export archives → goroot/pkg/wasip1_wasm/<import path>.a (GO-CONTRACT).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasm-go-std-wasip1

command -v go >/dev/null || { echo "missing go" >&2; exit 1; }
HOST_GO="$(go env GOVERSION)"
WANT="go${VER}"
if [[ "$HOST_GO" != "$WANT" ]]; then
  echo "homescoop: host GOVERSION is $HOST_GO but recipe wants $WANT" >&2
  exit 1
fi

OUT="$WORK/wasm-go-std-wasip1-${VER}"
DIR="$OUT/goroot/pkg/wasip1_wasm"
mkdir -p "$DIR"

export GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0

echo "== wasm-go-std-wasip1: stage .a from go list -export (wasip1/wasm)"
rm -rf "$DIR"
mkdir -p "$DIR"
n=0
while read -r importpath exportpath; do
  [[ -n "$importpath" && -f "$exportpath" ]] || continue
  dest="$DIR/${importpath}.a"
  mkdir -p "$(dirname "$dest")"
  cp "$exportpath" "$dest"
  n=$((n + 1))
done < <(go list -export -trimpath -gcflags=all=-dwarf=false \
  -f '{{if .Export}}{{.ImportPath}} {{.Export}}{{end}}' std)

echo "== wasm-go-std-wasip1: staged $n archives"
test "$n" -gt 50
# unsafe must not appear
test ! -e "$DIR/unsafe.a"
du -sh "$DIR"

DEST="$HOMESCOOP_PKG/package/goroot"
rm -rf "$DEST"
mkdir -p "$DEST/pkg"
cp -R "$OUT/goroot/pkg/wasip1_wasm" "$DEST/pkg/wasip1_wasm"

if [[ -f "$(go env GOROOT)/LICENSE" ]]; then
  homescoop_stage_license "$(go env GOROOT)/LICENSE"
else
  curl -fsSL "https://raw.githubusercontent.com/golang/go/go${VER}/LICENSE" \
    -o "$HOMESCOOP_PKG/package/LICENSE"
fi

echo "== wasm-go-std-wasip1: staged → $HOMESCOOP_PKG/package ($WANT)"
echo "== note: if npm pack > 40 MiB gzipped, split this recipe further"
