#!/usr/bin/env bash
# zlib build.sh — host ladder body (ladder.sh rung_zlib).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
HOMESCOOP_PKG="$ROOT/packages/zlib"
VERSION=1.3.1
SRC_URL=https://zlib.net/fossils/zlib-1.3.1.tar.gz
SRC_SHA=9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23
SRC_DIR="$WORK/zlib-$VERSION"
TARBALL="$WORK/zlib-$VERSION.tar.gz"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"

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
echo "== zlib: staged ($sz bytes)"
