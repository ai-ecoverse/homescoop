#!/usr/bin/env bash
# zlib build.sh — host ladder body (ladder.sh rung_zlib).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe zlib
SRC_DIR="$WORK/zlib-$VERSION"
TARBALL="$WORK/zlib-$VERSION.tar.gz"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"
homescoop_apply_patches "$SRC_DIR"

if [[ ! -f "$SRC_DIR/libz.a" || -n "${FORCE:-}" ]]; then
  echo "== zlib: emconfigure + emmake"
  (
    cd "$SRC_DIR"
    emconfigure ./configure --static
    homescoop_fix_darwin_ar Makefile
    emmake make libz.a
  )
fi
test -f "$SRC_DIR/libz.a"
sz=$(homescoop_require_lib_size "$SRC_DIR/libz.a")
homescoop_stage_lib "$SRC_DIR/libz.a" libz.a
homescoop_stage_headers "$SRC_DIR/zlib.h" "$SRC_DIR/zconf.h"
homescoop_stage_license "$SRC_DIR"/LICENSE "$SRC_DIR"/COPYING "$SRC_DIR"/COPYING.LIB "$SRC_DIR"/license.txt "$SRC_DIR"/LICENSE.md
echo "== zlib: staged ($sz bytes)"
