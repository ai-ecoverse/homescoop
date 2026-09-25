#!/usr/bin/env bash
# zlib build.sh — host ladder body for @ai-ecoverse/wasm-zlib.
# Mirrors ladder.sh rung_zlib: emconfigure ./configure --static && emmake make libz.a
set -euo pipefail

ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
PKG="$ROOT/packages/zlib"
VERSION=1.3.1
SRC_URL=https://zlib.net/zlib-1.3.1.tar.gz
SRC_SHA=cc0b4e42510d49c6decd464123ecf3b14ae9b47f9b4ed2ee64893e2d6520a264
WORK="${HOMESCOOP_WORK:-${TMPDIR:-/tmp}/homescoop-work}"
PREFIX="${PREFIX:-${TMPDIR:-/tmp}/homescoop-prefix}"
SRC_DIR="$WORK/zlib-$VERSION"
TARBALL="$WORK/zlib-$VERSION.tar.gz"

mkdir -p "$WORK" "$PREFIX/lib" "$PREFIX/include"

if [[ ! -f "$TARBALL" ]]; then
  echo "== zlib: fetch $SRC_URL"
  curl -fsSL "$SRC_URL" -o "$TARBALL"
fi
echo "$SRC_SHA  $TARBALL" | shasum -a 256 -c -

if [[ ! -f "$SRC_DIR/configure" || -n "${FORCE:-}" ]]; then
  rm -rf "$SRC_DIR"
  tar xzf "$TARBALL" -C "$WORK"
fi

if [[ ! -f "$SRC_DIR/libz.a" || -n "${FORCE:-}" ]]; then
  echo "== zlib: emconfigure + emmake"
  (
    cd "$SRC_DIR"
    emconfigure ./configure --static
    emmake make libz.a
  )
fi
test -f "$SRC_DIR/libz.a"

dest_lib="$PKG/package/lib"
dest_inc="$PKG/package/include"
mkdir -p "$dest_lib" "$dest_inc"
cp "$SRC_DIR/libz.a" "$dest_lib/libz.a"
cp "$SRC_DIR/zlib.h" "$dest_inc/zlib.h"
cp "$SRC_DIR/zconf.h" "$dest_inc/zconf.h"
cp "$SRC_DIR/libz.a" "$PREFIX/lib/libz.a"
cp "$SRC_DIR/zlib.h" "$PREFIX/include/zlib.h"
cp "$SRC_DIR/zconf.h" "$PREFIX/include/zconf.h"
echo "== zlib: staged → $PKG/package/{lib,include} and $PREFIX"
