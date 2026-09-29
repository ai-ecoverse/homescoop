#!/usr/bin/env bash
# libjpeg-turbo build.sh — ladder.sh rung_jpeg (emcmake, no SIMD).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe libjpeg-turbo
SRC_DIR="$WORK/libjpeg-turbo-$VERSION"
TARBALL="$WORK/libjpeg-turbo-$VERSION.tar.gz"
BUILD="$SRC_DIR/build"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"

if [[ ! -f "$BUILD/libjpeg.a" || -n "${FORCE:-}" ]]; then
  echo "== libjpeg-turbo: emcmake + jpeg-static"
  (
    cd "$SRC_DIR"
    emcmake cmake -S . -B build -G "Unix Makefiles" \
      -DWITH_SIMD=0 \
      -DENABLE_SHARED=0 \
      -DCMAKE_BUILD_TYPE=Release
    cmake --build build --target jpeg-static
  )
fi
test -f "$BUILD/libjpeg.a"
sz=$(homescoop_require_lib_size "$BUILD/libjpeg.a")
homescoop_stage_lib "$BUILD/libjpeg.a" libjpeg.a
# Magick.Native deps prefix expects this name
cp "$BUILD/libjpeg.a" "$HOMESCOOP_PKG/package/lib/libturbojpeg.a"
cp "$BUILD/libjpeg.a" "$PREFIX/lib/libturbojpeg.a"
homescoop_stage_headers \
  "$SRC_DIR/src/jpeglib.h" \
  "$SRC_DIR/src/jerror.h" \
  "$SRC_DIR/src/jmorecfg.h" \
  "$BUILD/jconfig.h"
homescoop_write_pc libjpeg "$VERSION" "-ljpeg"
homescoop_stage_license "$SRC_DIR"/LICENSE "$SRC_DIR"/COPYING "$SRC_DIR"/README.ijg
echo "== libjpeg-turbo: staged ($sz bytes)"
