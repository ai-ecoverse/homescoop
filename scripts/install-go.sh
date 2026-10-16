#!/usr/bin/env bash
set -euo pipefail
NAME="${1:?usage: install-go.sh <recipe> <dest-dir>}"
DEST="${2:?usage: install-go.sh <recipe> <dest-dir>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) KEY=go_linux_amd64 ;;
  Darwin-arm64) KEY=go_darwin_arm64 ;;
  *) echo "install-go: no Go toolchain source for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac
eval "$(node "$ROOT/scripts/recipe-env.mjs" "$NAME" --source "$KEY")"
PREFIX_UP="$(printf %s "$KEY" | tr '[:lower:]' '[:upper:]')"
URL_VAR="${PREFIX_UP}_URL"
SHA_VAR="${PREFIX_UP}_SHA"
URL="${!URL_VAR:?install-go: recipe $NAME has no sources.$KEY.url}"
SHA="${!SHA_VAR:?install-go: recipe $NAME has no sources.$KEY.sha256}"
FILE="$(basename "$URL")"
GOROOT_DIR="$DEST/${FILE%.tar.gz}"
STAMP="$GOROOT_DIR/.homescoop-go"
if [[ -f "$STAMP" && "$(cat "$STAMP")" == "$URL $SHA" && -x "$GOROOT_DIR/bin/go" ]]; then
  echo "== install-go: $GOROOT_DIR already has $FILE" >&2
else
  mkdir -p "$DEST"
  echo "== install-go: fetch $URL" >&2
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$URL" -o "$DEST/$FILE.part"
  echo "$SHA  $DEST/$FILE.part" | shasum -a 256 -c - >&2
  rm -rf "$GOROOT_DIR"
  mkdir -p "$GOROOT_DIR"
  tar -xzf "$DEST/$FILE.part" -C "$GOROOT_DIR" --strip-components=1
  rm -f "$DEST/$FILE.part"
  printf '%s %s\n' "$URL" "$SHA" >"$STAMP"
  echo "== install-go: $FILE → $GOROOT_DIR" >&2
fi
printf 'export GOROOT=%q\nexport PATH=%q:"$PATH"\nexport GOTOOLCHAIN=local\n' "$GOROOT_DIR" "$GOROOT_DIR/bin"
