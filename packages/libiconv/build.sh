#!/usr/bin/env bash
# GNU libiconv 1.18 — static wasm archive for libxml2 --with-iconv.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe libiconv
SRC_DIR="$WORK/libiconv-$VERSION"
TARBALL="$WORK/libiconv-$VERSION.tar.gz"
DEST="$WORK/libiconv-dest"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR" "$DEST"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"
homescoop_apply_patches "$SRC_DIR"

if [[ ! -f "$DEST/lib/libiconv.a" || -n "${FORCE:-}" ]]; then
  echo "== libiconv: emconfigure + emmake install"
  rm -rf "$DEST"
  (
    cd "$SRC_DIR"
    emconfigure ./configure \
      --host=wasm32-unknown-emscripten \
      --disable-dependency-tracking \
      --disable-shared --enable-static --disable-nls \
      --prefix="$DEST"
    homescoop_fix_darwin_ar Makefile
    homescoop_fix_darwin_ar lib/Makefile 2>/dev/null || true
    homescoop_fix_darwin_ar libcharset/lib/Makefile 2>/dev/null || true
    emmake make
    emmake make install
  )
fi
test -f "$DEST/lib/libiconv.a"
test -f "$DEST/include/iconv.h"
sz=$(homescoop_require_lib_size "$DEST/lib/libiconv.a")
homescoop_stage_lib "$DEST/lib/libiconv.a" libiconv.a
if [[ -f "$DEST/lib/libcharset.a" ]]; then
  homescoop_stage_lib "$DEST/lib/libcharset.a" libcharset.a
fi
homescoop_stage_headers "$DEST/include/iconv.h"
if [[ -f "$DEST/include/libcharset.h" ]]; then
  homescoop_stage_headers "$DEST/include/libcharset.h"
fi
homescoop_write_pc libiconv "$VERSION" "-liconv"
homescoop_stage_license "$SRC_DIR"/COPYING.LIB "$SRC_DIR"/COPYING "$SRC_DIR"/LICENSE
echo "== libiconv: staged ($sz bytes)"
