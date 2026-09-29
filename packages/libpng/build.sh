#!/usr/bin/env bash
# libpng build.sh — ladder-aligned host body.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe libpng
SRC_DIR="$WORK/libpng-1.6.50"
TARBALL="$WORK/libpng-1.6.50.tar.gz"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"
homescoop_apply_patches "$SRC_DIR"
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
homescoop_write_pc libpng "$VERSION" "-lpng16" "zlib"
homescoop_stage_license "$SRC_DIR"/LICENSE "$SRC_DIR"/COPYING "$SRC_DIR"/COPYING.LIB "$SRC_DIR"/license.txt "$SRC_DIR"/LICENSE.md
echo "== libpng: staged → $HOMESCOOP_PKG/package"
