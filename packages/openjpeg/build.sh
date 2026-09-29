#!/usr/bin/env bash
# openjpeg build.sh — ladder.sh rung_openjpeg (emcmake, codec off).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe openjpeg
SRC_DIR="$WORK/openjpeg-$VERSION"
TARBALL="$WORK/openjpeg-$VERSION.tar.gz"
BUILD="$SRC_DIR/build"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"
homescoop_apply_patches "$SRC_DIR"

if [[ ! -f "$BUILD/bin/libopenjp2.a" || -n "${FORCE:-}" ]]; then
  echo "== openjpeg: emcmake"
  (
    cd "$SRC_DIR"
    emcmake cmake -S . -B build -G "Unix Makefiles" \
      -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_SHARED_LIBS=OFF \
      -DBUILD_CODEC=OFF \
      -DBUILD_TESTING=OFF
    cmake --build build
  )
fi
test -f "$BUILD/bin/libopenjp2.a"
sz=$(homescoop_require_lib_size "$BUILD/bin/libopenjp2.a")
homescoop_stage_lib "$BUILD/bin/libopenjp2.a" libopenjp2.a
# Public API: openjpeg.h + generated opj_config.h (2.5.x has no opj_stdint.h)
mkdir -p "$HOMESCOOP_PKG/package/include/openjpeg-$VERSION" "$PREFIX/include/openjpeg-$VERSION"
for h in openjpeg.h; do
  cp "$SRC_DIR/src/lib/openjp2/$h" "$HOMESCOOP_PKG/package/include/openjpeg-$VERSION/"
  cp "$SRC_DIR/src/lib/openjp2/$h" "$PREFIX/include/openjpeg-$VERSION/"
done
cp "$BUILD/src/lib/openjp2/opj_config.h" "$HOMESCOOP_PKG/package/include/openjpeg-$VERSION/"
cp "$BUILD/src/lib/openjp2/opj_config.h" "$PREFIX/include/openjpeg-$VERSION/"
homescoop_stage_headers \
  "$SRC_DIR/src/lib/openjp2/openjpeg.h" \
  "$BUILD/src/lib/openjp2/opj_config.h"
homescoop_write_pc libopenjp2 "$VERSION" "-lopenjp2"
homescoop_stage_license "$SRC_DIR"/LICENSE "$SRC_DIR"/COPYING "$SRC_DIR"/COPYING.LIB "$SRC_DIR"/license.txt "$SRC_DIR"/LICENSE.md
echo "== openjpeg: staged ($sz bytes)"
