#!/usr/bin/env bash
# lcms2 build.sh — ladder-aligned host body.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe lcms2
SRC_DIR="$WORK/lcms2-2.17"
TARBALL="$WORK/lcms2-2.17.tar.gz"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"
homescoop_apply_patches "$SRC_DIR"
if [[ ! -f "$SRC_DIR/src/.libs/liblcms2.a" || -n "${FORCE:-}" ]]; then
  echo "== lcms2: emconfigure + emmake"
  (
    cd "$SRC_DIR"
    emconfigure ./configure --disable-dependency-tracking --disable-shared --enable-static --without-jpeg --without-tiff \
      CPPFLAGS="-I$PREFIX/include" LDFLAGS="-L$PREFIX/lib"
    homescoop_fix_darwin_ar Makefile
    homescoop_fix_darwin_ar src/Makefile
    emmake make -C src
  )
fi
test -f "$SRC_DIR/src/.libs/liblcms2.a"
sz=$(homescoop_require_lib_size "$SRC_DIR/src/.libs/liblcms2.a")
homescoop_stage_lib "$SRC_DIR/src/.libs/liblcms2.a" liblcms2.a
mkdir -p "$HOMESCOOP_PKG/package/include" "$PREFIX/include"
cp "$SRC_DIR/include/"*.h "$HOMESCOOP_PKG/package/include/"
cp "$SRC_DIR/include/"*.h "$PREFIX/include/"
homescoop_stage_license "$SRC_DIR"/LICENSE "$SRC_DIR"/COPYING "$SRC_DIR"/COPYING.LIB "$SRC_DIR"/license.txt "$SRC_DIR"/LICENSE.md
echo "== lcms2: staged → $HOMESCOOP_PKG/package"
