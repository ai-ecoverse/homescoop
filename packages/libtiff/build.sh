#!/usr/bin/env bash
# libtiff build.sh — ladder.sh rung_tiff (zlib + jpeg from PREFIX).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe libtiff
SRC_DIR="$WORK/tiff-$VERSION"
TARBALL="$WORK/tiff-$VERSION.tar.gz"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"
homescoop_apply_patches "$SRC_DIR"

if [[ ! -f "$SRC_DIR/libtiff/.libs/libtiff.a" || -n "${FORCE:-}" ]]; then
  echo "== libtiff: emconfigure + emmake (zlib/jpeg from PREFIX)"
  test -f "$PREFIX/include/zlib.h" || { echo "missing zlib in PREFIX=$PREFIX" >&2; exit 1; }
  test -f "$PREFIX/include/jpeglib.h" || { echo "missing jpeg in PREFIX=$PREFIX" >&2; exit 1; }
  (
    cd "$SRC_DIR"
    emconfigure ./configure \
      --disable-dependency-tracking \
      --disable-shared --enable-static \
      --disable-tools --disable-tests --disable-contrib --disable-docs \
      --disable-webp --disable-zstd --disable-lzma --disable-jbig \
      --disable-libdeflate --disable-lerc --disable-cxx \
      CPPFLAGS="-I$PREFIX/include" \
      LDFLAGS="-L$PREFIX/lib"
    homescoop_fix_darwin_ar libtiff/Makefile
    homescoop_fix_darwin_ar port/Makefile 2>/dev/null || true
    emmake make -C port
    emmake make -C libtiff
  )
fi
test -f "$SRC_DIR/libtiff/.libs/libtiff.a"
sz=$(homescoop_require_lib_size "$SRC_DIR/libtiff/.libs/libtiff.a")
homescoop_stage_lib "$SRC_DIR/libtiff/.libs/libtiff.a" libtiff.a
# Public headers + generated tiffconf.h / tif_config.h
homescoop_stage_headers \
  "$SRC_DIR/libtiff/tiff.h" \
  "$SRC_DIR/libtiff/tiffio.h" \
  "$SRC_DIR/libtiff/tiffvers.h" \
  "$SRC_DIR/libtiff/tiffconf.h" \
  "$SRC_DIR/libtiff/tif_config.h"
homescoop_write_pc libtiff-4 "$VERSION" "-ltiff" "zlib libjpeg"
homescoop_stage_license "$SRC_DIR"/LICENSE "$SRC_DIR"/COPYING "$SRC_DIR"/COPYING.LIB "$SRC_DIR"/license.txt "$SRC_DIR"/LICENSE.md
echo "== libtiff: staged ($sz bytes)"
