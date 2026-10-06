#!/usr/bin/env bash
# freetype build.sh — ladder-aligned host body.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe freetype
SRC_DIR="$WORK/freetype-2.13.3"
TARBALL="$WORK/freetype-2.13.3.tar.gz"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"
homescoop_apply_patches "$SRC_DIR"
if [[ ! -f "$SRC_DIR/objs/.libs/libfreetype.a" || -n "${FORCE:-}" ]]; then
  echo "== freetype: emconfigure + emmake"
  (
    cd "$SRC_DIR"
    # emconfigure sets CC_BUILD=emcc; apinames must be a host binary.
    MAKE="${MAKE:-gmake}" emconfigure ./configure --disable-dependency-tracking \
      --disable-shared --enable-static \
      --without-harfbuzz --without-brotli --without-bzip2 --without-png --with-zlib=no
    homescoop_fix_darwin_ar Makefile
    if [[ -f builds/unix/unix-cc.mk ]]; then
      perl -i -pe 's|^CCraw_build\s*:=.*|CCraw_build := /usr/bin/clang|' builds/unix/unix-cc.mk
    fi
    emmake make
  )
fi
test -f "$SRC_DIR/objs/.libs/libfreetype.a"
sz=$(homescoop_require_lib_size "$SRC_DIR/objs/.libs/libfreetype.a")
homescoop_stage_lib "$SRC_DIR/objs/.libs/libfreetype.a" libfreetype.a
mkdir -p "$HOMESCOOP_PKG/package/include" "$PREFIX/include"
# FreeType public headers live under include/
cp -R "$SRC_DIR/include/." "$HOMESCOOP_PKG/package/include/"
cp -R "$SRC_DIR/include/." "$PREFIX/include/"
homescoop_write_pc freetype2 "$VERSION" "-lfreetype"
homescoop_stage_license "$SRC_DIR"/LICENSE "$SRC_DIR"/COPYING "$SRC_DIR"/COPYING.LIB "$SRC_DIR"/license.txt "$SRC_DIR"/LICENSE.md
echo "== freetype: staged → $HOMESCOOP_PKG/package"
