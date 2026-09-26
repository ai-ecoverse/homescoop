#!/usr/bin/env bash
# libwebp build.sh — ladder-aligned host body.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
HOMESCOOP_PKG="$ROOT/packages/libwebp"
VERSION=1.5.0
SRC_URL=https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.5.0.tar.gz
SRC_SHA=7d6fab70cf844bf6769077bd5d7a74893f8ffd4dfb42861745750c63c2a5c92c
SRC_DIR="$WORK/libwebp-1.5.0"
TARBALL="$WORK/libwebp-1.5.0.tar.gz"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"
if [[ ! -f "$SRC_DIR/src/demux/.libs/libwebpdemux.a" || -n "${FORCE:-}" ]]; then
  echo "== libwebp: emconfigure + emmake"
  (
    cd "$SRC_DIR"
    emconfigure ./configure --disable-dependency-tracking --disable-shared --enable-static \
      --enable-libwebpmux --enable-libwebpdemux --disable-libwebpdecoder \
      --disable-png --disable-jpeg --disable-tiff --disable-gif --disable-wic \
      --disable-sdl --disable-gl --disable-sse2 --disable-sse4.1 --disable-neon --disable-threading
    homescoop_fix_darwin_ar Makefile
    emmake make -C sharpyuv
    emmake make -C src
  )
fi
test -f "$SRC_DIR/src/.libs/libwebp.a"
homescoop_stage_lib "$SRC_DIR/src/.libs/libwebp.a" libwebp.a
homescoop_stage_lib "$SRC_DIR/src/mux/.libs/libwebpmux.a" libwebpmux.a
homescoop_stage_lib "$SRC_DIR/src/demux/.libs/libwebpdemux.a" libwebpdemux.a
homescoop_stage_lib "$SRC_DIR/sharpyuv/.libs/libsharpyuv.a" libsharpyuv.a
mkdir -p "$HOMESCOOP_PKG/package/include/webp" "$PREFIX/include/webp"
cp "$SRC_DIR/src/webp/"*.h "$HOMESCOOP_PKG/package/include/webp/"
cp "$SRC_DIR/src/webp/"*.h "$PREFIX/include/webp/"
cp "$SRC_DIR/sharpyuv/sharpyuv.h" "$HOMESCOOP_PKG/package/include/" 2>/dev/null || true
echo "== libwebp: staged → $HOMESCOOP_PKG/package"
