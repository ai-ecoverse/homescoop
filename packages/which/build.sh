#!/usr/bin/env bash
# GNU which — small autoconf CLI for slicc.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe which

TB="$WORK/which-$VERSION.tar.gz"
SRC="$WORK/which-$VERSION"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC"; fi
homescoop_extract "$TB" "$SRC"
homescoop_apply_patches "$SRC"

SLICC_A="$WORK/libslicc-cli.a"
homescoop_slicc_archive "$SLICC_A" cli

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=262144 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
CLI_LDFLAGS="$(homescoop_slicc_keep_exports) $(homescoop_em_cli_ldflags)"
CLI_LIBS="-Wl,--whole-archive ${SLICC_A} -Wl,--no-whole-archive"

export ac_cv_func_malloc_0_nonnull=yes
export ac_cv_func_realloc_0_nonnull=yes

need_build=0
if [[ ! -f "$SRC/which" && ! -f "$SRC/which.js" ]] || [[ -n "${FORCE:-}" ]]; then
  need_build=1
fi

if [[ "$need_build" -eq 1 ]]; then
  echo "== which: emconfigure + emmake"
  (
    cd "$SRC"
    if [[ -f Makefile ]]; then make distclean >/dev/null 2>&1 || true; fi
    env -u LDFLAGS -u CFLAGS -u CPPFLAGS -u LIBS \
      emconfigure ./configure \
        --build=x86_64-pc-linux-gnu --host=wasm32-unknown-emscripten \
        --disable-nls \
        --disable-dependency-tracking \
        CFLAGS="-O2"
    homescoop_fix_darwin_ar Makefile
    jobs="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
    # shellcheck disable=SC2086
    emmake make -j"$jobs" LDFLAGS="$CLI_LDFLAGS" LIBS="$CLI_LIBS"
  )
fi

if [[ -f "$SRC/which.js" && ! -f "$SRC/which" ]]; then
  mv "$SRC/which.js" "$SRC/which"
fi
test -f "$SRC/which.wasm"
homescoop_stage_cli "$SRC" which
homescoop_stage_license "$SRC"/COPYING "$SRC"/LICENSE
echo "== which: staged → $HOMESCOOP_PKG/package ($VERSION)"
