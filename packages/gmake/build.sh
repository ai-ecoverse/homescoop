#!/usr/bin/env bash
# GNU make 4.4.1 — host body (port of slicc-emscripten/build-wasm-make.sh).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
HOMESCOOP_PKG="$ROOT/packages/gmake"
VERSION=4.4.1
SRC_URL=https://ftp.gnu.org/gnu/make/make-4.4.1.tar.gz
SRC_SHA=dd16fb1d67bfab79a72f5e8390735c49e3e8e70b4945a15ab1f81ddb78658fb3
SRC_DIR="$WORK/make-$VERSION"
TARBALL="$WORK/make-$VERSION.tar.gz"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"

SLICC_A="$WORK/libslicc-make.a"
homescoop_slicc_archive "$SLICC_A" make

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1048576 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
CLI_LDFLAGS="$(homescoop_em_cli_ldflags)"
# Archive + force signal exports (realm calls them from JS).
MAKE_LIBS="$SLICC_A $(homescoop_slicc_keep_exports)"

if [[ ! -f "$SRC_DIR/make" && ! -f "$SRC_DIR/make.js" || -n "${FORCE:-}" ]]; then
  echo "== gmake: emconfigure + emmake"
  (
    cd "$SRC_DIR"
    if [[ -f Makefile ]]; then
      make distclean >/dev/null 2>&1 || true
    fi
    emconfigure ./configure --host=wasm32-unknown-emscripten \
      --disable-nls --without-guile --disable-load --without-customs \
      LDFLAGS="$CLI_LDFLAGS"
    homescoop_fix_darwin_ar Makefile
    # main_envp provides real main; rename make's main.
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
      CPPFLAGS="-Dmain=slicc_tool_main" \
      LIBS="$MAKE_LIBS"
  )
fi
test -f "$SRC_DIR/make" || test -f "$SRC_DIR/make.js"
homescoop_stage_cli "$SRC_DIR" make
echo "== gmake: staged → $HOMESCOOP_PKG/package"
