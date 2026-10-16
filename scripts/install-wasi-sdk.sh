#!/usr/bin/env bash
set -euo pipefail

# renovate: datasource=github-releases depName=WebAssembly/wasi-sdk extractVersion=^wasi-sdk-(?<version>\d+)$
WASI_SDK_MAJOR="34"
VERSION="${HOMESCOOP_WASI_SDK_VERSION:-$WASI_SDK_MAJOR.0}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)
    ARCH=x86_64-linux
    PINNED_SHA="b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4"
    ;;
  Darwin-arm64)
    ARCH=arm64-macos
    PINNED_SHA="9c59398106b417f8f14913380fdf0097a8cc0ff4af9eb3ce0065a859e88d49e9"
    ;;
  *)
    echo "install-wasi-sdk: unsupported host $(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac
NAME="wasi-sdk-$VERSION-$ARCH"
if [[ "${1:-}" == --name ]]; then
  printf '%s\n' "$NAME"
  exit 0
fi
if [[ -n "${HOMESCOOP_WASI_SDK_VERSION:-}" ]]; then
  SHA="${HOMESCOOP_WASI_SDK_SHA:?install-wasi-sdk: HOMESCOOP_WASI_SDK_VERSION needs HOMESCOOP_WASI_SDK_SHA}"
else
  SHA="${HOMESCOOP_WASI_SDK_SHA:-$PINNED_SHA}"
fi
DEST="${1:?usage: install-wasi-sdk.sh <dest-dir> | --name}"
URL="https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${VERSION%%.*}/$NAME.tar.gz"
STAMP="$DEST/.homescoop-wasi-sdk"
WANT="$NAME $SHA"

if [[ -f "$STAMP" && "$(cat "$STAMP")" == "$WANT" ]]; then
  echo "== install-wasi-sdk: $DEST already has $NAME" >&2
else
  echo "== install-wasi-sdk: fetch $URL" >&2
  mkdir -p "$(dirname "$DEST")"
  TMP="$(mktemp -d "$(dirname "$DEST")/.wasi-sdk.XXXXXX")"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$URL" -o "$TMP/sdk.tar.gz"
  echo "$SHA  $TMP/sdk.tar.gz" | shasum -a 256 -c - >&2
  mkdir "$TMP/sdk"
  tar -xzf "$TMP/sdk.tar.gz" --strip-components=1 -C "$TMP/sdk"
  test -x "$TMP/sdk/bin/clang"
  test -d "$TMP/sdk/share/wasi-sysroot"
  echo "$WANT" > "$TMP/sdk/.homescoop-wasi-sdk"
  rm -rf "$DEST"
  mv "$TMP/sdk" "$DEST"
  echo "== install-wasi-sdk: installed $NAME → $DEST" >&2
fi

cat <<EOF
export WASI_SDK_PATH=$(printf %q "$DEST")
export WASI_SYSROOT=$(printf %q "$DEST/share/wasi-sysroot")
EOF
