#!/usr/bin/env bash
# pkgconf build.sh — ladder-aligned host body.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
HOMESCOOP_PKG="$ROOT/packages/pkgconf"
VERSION=2.3.0
SRC_URL=https://distfiles.ariadne.space/pkgconf/pkgconf-2.3.0.tar.gz
SRC_SHA=a2df680578e85f609f2fa67bd3d0fc0dc71b4bf084fc49119de84cd6ed28e723
SRC_DIR="$WORK/pkgconf-2.3.0"
TARBALL="$WORK/pkgconf-2.3.0.tar.gz"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"
if [[ ! -f "$SRC_DIR/pkgconf" || -n "${FORCE:-}" ]]; then
  echo "== pkgconf: emconfigure + emmake"
  (
    cd "$SRC_DIR"
    emconfigure ./configure --disable-dependency-tracking --disable-shared --enable-static LDFLAGS=-sSTACK_SIZE=1MB
    homescoop_fix_darwin_ar Makefile
    emmake make pkgconf
  )
fi
test -f "$SRC_DIR/pkgconf" || test -f "$SRC_DIR/pkgconf.js"
# Stage the wasm/js binary pair into package/bin
mkdir -p "$HOMESCOOP_PKG/package/bin" "$PREFIX/bin"
for f in pkgconf pkgconf.js pkgconf.wasm; do
  [[ -f "$SRC_DIR/$f" ]] && cp "$SRC_DIR/$f" "$HOMESCOOP_PKG/package/bin/" && cp "$SRC_DIR/$f" "$PREFIX/bin/"
done
# Convenience launcher name
if [[ -f "$HOMESCOOP_PKG/package/bin/pkgconf.js" ]]; then
  printf '#!/usr/bin/env node\nrequire("./pkgconf.js");\n' > "$HOMESCOOP_PKG/package/bin/pkg-config"
  chmod +x "$HOMESCOOP_PKG/package/bin/pkg-config"
fi
echo "== pkgconf: staged → $HOMESCOOP_PKG/package"
