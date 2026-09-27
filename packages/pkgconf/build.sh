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

SLICC_A="$WORK/libslicc-gaps.a"
homescoop_slicc_archive "$SLICC_A" gaps

# pkgconf_trace keeps a 64 KiB buffer on the stack (Emscripten's default).
export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1MB"
CLI_LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports) $SLICC_A"

if [[ ! -f "$SRC_DIR/pkgconf" && ! -f "$SRC_DIR/pkgconf.js" || -n "${FORCE:-}" ]]; then
  echo "== pkgconf: emconfigure + emmake"
  (
    cd "$SRC_DIR"
    emconfigure ./configure \
      --disable-dependency-tracking --disable-shared --enable-static \
      LDFLAGS="$(homescoop_em_cli_ldflags)"
    homescoop_fix_darwin_ar Makefile
    emmake make pkgconf LDFLAGS="$CLI_LDFLAGS"
  )
else
  # Relink when the binary exists but shims may have changed.
  echo "== pkgconf: relink with slicc gaps+signals"
  (
    cd "$SRC_DIR"
    emmake make pkgconf LDFLAGS="$CLI_LDFLAGS"
  )
fi
test -f "$SRC_DIR/pkgconf" || test -f "$SRC_DIR/pkgconf.js"
homescoop_stage_cli "$SRC_DIR" pkgconf
# Convenience launcher name (node realm)
if [[ -f "$HOMESCOOP_PKG/package/bin/pkgconf.js" || -f "$HOMESCOOP_PKG/package/bin/pkgconf" ]]; then
  printf '#!/usr/bin/env node\nrequire("./pkgconf");\n' > "$HOMESCOOP_PKG/package/bin/pkg-config"
  chmod +x "$HOMESCOOP_PKG/package/bin/pkg-config"
fi
echo "== pkgconf: staged → $HOMESCOOP_PKG/package"
