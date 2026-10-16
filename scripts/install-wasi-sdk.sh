#!/usr/bin/env bash
set -euo pipefail

# renovate: datasource=github-releases depName=WebAssembly/wasi-sdk extractVersion=^wasi-sdk-(?<version>\d+)$
WASI_SDK_MAJOR="24"
VERSION="${HOMESCOOP_WASI_SDK_VERSION:-$WASI_SDK_MAJOR.0}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)
    ARCH=x86_64-linux
    PINNED_SHA="c6c38aab56e5de88adf6c1ebc9c3ae8da72f88ec2b656fb024eda8d4167a0bc5"
    ;;
  Darwin-arm64)
    ARCH=arm64-macos
    PINNED_SHA="aeae999396d5f5caa5ce419f52e83c35869d5fd21d40af80acba2c80f51b0b3a"
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
