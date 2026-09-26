#!/usr/bin/env bash
# libpng build.sh — ladder-aligned host body.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
HOMESCOOP_PKG="$ROOT/packages/libpng"
VERSION=1.6.50
SRC_URL=https://downloads.sourceforge.net/project/libpng/libpng16/1.6.50/libpng-1.6.50.tar.gz
SRC_SHA=71158e53cfdf2877bc99bcab33641d78df3f48e6e0daad030afe9cb8c031aa46
SRC_DIR="$WORK/libpng-1.6.50"
TARBALL="$WORK/libpng-1.6.50.tar.gz"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"
if [[ ! -f "$SRC_DIR/.libs/libpng16.a" || -n "${FORCE:-}" ]]; then
  echo "== libpng: emconfigure + emmake (zlib from PREFIX)"
  (
    cd "$SRC_DIR"
    emconfigure ./configure --disable-dependency-tracking --host=wasm32-unknown-emscripten --disable-shared --enable-static \
      CPPFLAGS="-I$PREFIX/include" LDFLAGS="-L$PREFIX/lib"
    homescoop_fix_darwin_ar Makefile
    emmake make libpng16.la
  )
fi
test -f "$SRC_DIR/.libs/libpng16.a"
sz=$(homescoop_require_lib_size "$SRC_DIR/.libs/libpng16.a")
homescoop_stage_lib "$SRC_DIR/.libs/libpng16.a" libpng16.a
# Also ship unversioned name Magick.Native expects
cp "$SRC_DIR/.libs/libpng16.a" "$HOMESCOOP_PKG/package/lib/libpng.a"
cp "$SRC_DIR/.libs/libpng16.a" "$PREFIX/lib/libpng.a"
homescoop_stage_headers "$SRC_DIR/png.h" "$SRC_DIR/pngconf.h" "$SRC_DIR/pnglibconf.h"
echo "== libpng: staged → $HOMESCOOP_PKG/package"
