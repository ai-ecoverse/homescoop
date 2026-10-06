#!/usr/bin/env bash
# libxml2 build.sh — ladder-aligned host body.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe libxml2

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"
homescoop_apply_patches "$SRC_DIR"
# Prefer pre-fetched gz when present (gnome xz needs xz, gitlab may differ).
if [[ ! -f "$SRC_DIR/.libs/libxml2.a" || -n "${FORCE:-}" ]]; then
  echo "== libxml2: emconfigure + emmake"
  (
    cd "$SRC_DIR"
    if [[ ! -f configure && -f autogen.sh ]]; then NOCONFIGURE=1 ./autogen.sh; fi
    emconfigure ./configure --disable-dependency-tracking --disable-shared --enable-static \
      --without-python --without-lzma --without-zlib --without-http \
      --without-threads --without-modules --without-debug
    homescoop_fix_darwin_ar Makefile
    emmake make libxml2.la
  )
fi
test -f "$SRC_DIR/.libs/libxml2.a"
sz=$(homescoop_require_lib_size "$SRC_DIR/.libs/libxml2.a")
homescoop_stage_lib "$SRC_DIR/.libs/libxml2.a" libxml2.a
mkdir -p "$HOMESCOOP_PKG/package/include/libxml" "$PREFIX/include/libxml"
cp "$SRC_DIR/include/libxml/"*.h "$HOMESCOOP_PKG/package/include/libxml/"
cp "$SRC_DIR/include/libxml/"*.h "$PREFIX/include/libxml/"
homescoop_write_pc libxml-2.0 "$VERSION" "-lxml2"
homescoop_stage_license "$SRC_DIR"/LICENSE "$SRC_DIR"/COPYING "$SRC_DIR"/COPYING.LIB "$SRC_DIR"/license.txt "$SRC_DIR"/LICENSE.md
echo "== libxml2: staged → $HOMESCOOP_PKG/package"
