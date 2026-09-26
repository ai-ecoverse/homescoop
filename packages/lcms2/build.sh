#!/usr/bin/env bash
# lcms2 build.sh — ladder-aligned host body.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
HOMESCOOP_PKG="$ROOT/packages/lcms2"
VERSION=2.17
SRC_URL=https://github.com/mm2/Little-CMS/releases/download/lcms2.17/lcms2-2.17.tar.gz
SRC_SHA=d11af569e42a1baa1650d20ad61d12e41af4fead4aa7964a01f93b08b53ab074
SRC_DIR="$WORK/lcms2-2.17"
TARBALL="$WORK/lcms2-2.17.tar.gz"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"
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
echo "== lcms2: staged → $HOMESCOOP_PKG/package"
