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
# CMake stamps the version string with the build day ("build YYYYMMDD" in
# jcmaster.c.o); pin it to source.epoch in UTC so a rebuild on another day
# has the same bytes (homescoop#638).
SOURCE_DATE_EPOCH="$(node "$ROOT/scripts/read-recipe.mjs" libjpeg-turbo --field source.epoch)"
export SOURCE_DATE_EPOCH
JPEG_BUILD_DATE="$(node -e 'const e=process.argv[1]; if (!/^[0-9]+$/.test(e)) process.exit(1); const d=new Date(Number(e)*1000); console.log(d.toISOString().slice(0,10).replaceAll("-",""))' "$SOURCE_DATE_EPOCH")"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"

if [[ -f "$BUILD/CMakeCache.txt" ]] && ! grep -qx "BUILD:STRING=$JPEG_BUILD_DATE" "$BUILD/CMakeCache.txt"; then
  rm -rf "$BUILD"
fi
if [[ ! -f "$BUILD/libjpeg.a" || -n "${FORCE:-}" ]]; then
  echo "== libjpeg-turbo: emcmake + jpeg-static"
  (
    cd "$SRC_DIR"
    emcmake cmake -S . -B build -G "Unix Makefiles" \
      -DWITH_SIMD=0 \
      -DENABLE_SHARED=0 \
      -DCMAKE_BUILD_TYPE=Release \
      -DBUILD="$JPEG_BUILD_DATE"
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
homescoop_stage_licenses "$SRC_DIR"/LICENSE.md "$SRC_DIR"/README.ijg
if ! strings "$BUILD/libjpeg.a" | grep -q "(build $JPEG_BUILD_DATE)"; then
  echo "libjpeg-turbo: libjpeg.a does not carry build $JPEG_BUILD_DATE (homescoop#638)" >&2
  exit 1
fi
echo "== libjpeg-turbo: staged ($sz bytes)"
