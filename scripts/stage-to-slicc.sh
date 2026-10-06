#!/usr/bin/env bash
# Extract a homescoop package tree into slicc-emscripten staging for acceptance.
# Usage: stage-to-slicc.sh <package-dir-or-tgz> [staging-name]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:?usage: stage-to-slicc.sh <package-dir|tgz> [name]}"
SLICC_EM="${SLICC_EMSCRIPTEN:-$ROOT/../slicc-emscripten}"
STAGE_ROOT="$SLICC_EM/tmp-wasi/staging"

if [[ -d "$SRC" && -f "$SRC/package.json" ]]; then
  NAME="${2:-$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).name.replace(/^@[^/]+\//,""))' "$SRC/package.json")}"
  DEST="$STAGE_ROOT/$NAME"
  rm -rf "$DEST"
  mkdir -p "$DEST"
  # Copy contents (not the package/ wrapper)
  rsync -a --delete --exclude node_modules "$SRC"/ "$DEST"/
elif [[ -f "$SRC" && "$SRC" == *.tgz ]]; then
  tmp=$(mktemp -d)
  tar xzf "$SRC" -C "$tmp"
  NAME="${2:-$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).name.replace(/^@[^/]+\//,""))' "$tmp/package/package.json")}"
  DEST="$STAGE_ROOT/$NAME"
  rm -rf "$DEST"
  mkdir -p "$DEST"
  rsync -a "$tmp/package"/ "$DEST"/
  rm -rf "$tmp"
else
  echo "stage-to-slicc: need package dir or .tgz" >&2
  exit 1
fi

# Drop PRESTAGE.md alongside if present next to source
if [[ -f "$(dirname "$SRC")/PRESTAGE.md" ]]; then
  cp "$(dirname "$SRC")/PRESTAGE.md" "$DEST/PRESTAGE.md"
elif [[ -f "$ROOT/packages/${NAME#wasm-}/PRESTAGE.md" ]]; then
  cp "$ROOT/packages/${NAME#wasm-}/PRESTAGE.md" "$DEST/PRESTAGE.md" 2>/dev/null || true
fi

echo "== staged $DEST ($(du -sh "$DEST" | awk '{print $1}'))"
ls "$DEST" | head -20
