#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe patch

TB="$WORK/patch-$VER.tar.xz"
SRC="$WORK/patch-$VER"

homescoop_fetch "$URL" "$SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC"; fi
homescoop_extract "$TB" "$SRC"

SLICC_A="$WORK/libslicc-cli.a"
homescoop_slicc_archive "$SLICC_A" cli

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=524288 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
CLI_LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports)"
export ac_cv_func_getcwd=yes ac_cv_func_sigaction=yes

if [[ ! -f "$SRC/src/patch" && ! -f "$SRC/src/patch.js" && ! -f "$SRC/patch" || -n "${FORCE:-}" ]]; then
  echo "== patch: emconfigure + emmake"
  (
    cd "$SRC"
    if [[ -f Makefile ]]; then make distclean >/dev/null 2>&1 || true; fi
    emconfigure ./configure --host=wasm32-unknown-emscripten --disable-nls
    homescoop_fix_darwin_ar Makefile
    # shellcheck disable=SC2086
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
      LDFLAGS="$SLICC_A $CLI_LDFLAGS"
  )
fi
STAGE="$SRC/src"
[[ -d "$STAGE" ]] || STAGE="$SRC"
if [[ -f "$STAGE/patch.js" && ! -f "$STAGE/patch" ]]; then mv "$STAGE/patch.js" "$STAGE/patch"; fi
test -f "$STAGE/patch.wasm" || test -f "$STAGE/patch"
homescoop_stage_cli "$STAGE" patch
homescoop_stage_license "$SRC"/COPYING "$SRC"/LICENSE
homescoop_notices_begin "patch.wasm statically links the following."
homescoop_notice_emscripten
echo "== patch: staged → $HOMESCOOP_PKG/package"
