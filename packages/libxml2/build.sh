#!/usr/bin/env bash
# libxml2 2.15 — --with-iconv against PREFIX (wasm-libiconv).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe libxml2
SRC_DIR="$WORK/libxml2-$VERSION"
TARBALL="$WORK/libxml2-$VERSION.tar.xz"

test -f "$PREFIX/include/iconv.h" || { echo "missing iconv.h in PREFIX=$PREFIX (need wasm-libiconv)" >&2; exit 1; }
test -f "$PREFIX/lib/libiconv.a" || { echo "missing libiconv.a in PREFIX=$PREFIX" >&2; exit 1; }

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"
homescoop_apply_patches "$SRC_DIR"
if [[ ! -f "$SRC_DIR/.libs/libxml2.a" || -n "${FORCE:-}" ]]; then
  echo "== libxml2: emconfigure --with-iconv=$PREFIX"
  (
    cd "$SRC_DIR"
    if [[ ! -f configure && -f autogen.sh ]]; then NOCONFIGURE=1 ./autogen.sh; fi
    emconfigure ./configure --host=wasm32-unknown-emscripten \
      --disable-dependency-tracking --disable-shared --enable-static \
      --without-python --without-lzma --without-zlib --without-http \
      --without-threads --without-modules --without-debug \
      --with-iconv="$PREFIX" \
      CPPFLAGS="-I$PREFIX/include" LDFLAGS="-L$PREFIX/lib"
    homescoop_fix_darwin_ar Makefile
    emmake make libxml2.la
  )
fi
test -f "$SRC_DIR/.libs/libxml2.a"
if ! grep -q 'define LIBXML_ICONV_ENABLED' "$SRC_DIR/include/libxml/xmlversion.h"; then
  echo "libxml2: LIBXML_ICONV_ENABLED missing after configure" >&2
  exit 1
fi
sz=$(homescoop_require_lib_size "$SRC_DIR/.libs/libxml2.a")
homescoop_stage_lib "$SRC_DIR/.libs/libxml2.a" libxml2.a
mkdir -p "$HOMESCOOP_PKG/package/include/libxml" "$PREFIX/include/libxml"
cp "$SRC_DIR/include/libxml/"*.h "$HOMESCOOP_PKG/package/include/libxml/"
cp "$SRC_DIR/include/libxml/"*.h "$PREFIX/include/libxml/"
homescoop_write_pc libxml-2.0 "$VERSION" "-lxml2 -liconv"
homescoop_stage_license "$SRC_DIR"/Copyright "$SRC_DIR"/LICENSE "$SRC_DIR"/COPYING "$SRC_DIR"/COPYING.LIB "$SRC_DIR"/license.txt "$SRC_DIR"/LICENSE.md

echo "== libxml2: encoding smoke (iconv)"
SMOKE_JS="$WORK/libxml2-iconv-smoke.js"
emcc "$HOMESCOOP_PKG/smoke.c" \
  -O0 -I"$PREFIX/include" -L"$PREFIX/lib" -lxml2 -liconv \
  -sINVOKE_RUN=1 -sALLOW_MEMORY_GROWTH=1 \
  -o "$SMOKE_JS"
node "$SMOKE_JS"

echo "== libxml2: staged → $HOMESCOOP_PKG/package ($sz bytes)"
