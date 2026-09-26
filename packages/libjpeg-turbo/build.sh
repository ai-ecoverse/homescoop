#!/usr/bin/env bash
# libjpeg-turbo build.sh — ladder.sh rung_jpeg (emcmake, no SIMD).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
HOMESCOOP_PKG="$ROOT/packages/libjpeg-turbo"
VERSION=3.1.2
SRC_URL=https://github.com/libjpeg-turbo/libjpeg-turbo/releases/download/3.1.2/libjpeg-turbo-3.1.2.tar.gz
SRC_SHA=8f0012234b464ce50890c490f18194f913a7b1f4e6a03d6644179fa0f867d0cf
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
echo "== libjpeg-turbo: staged ($sz bytes)"
