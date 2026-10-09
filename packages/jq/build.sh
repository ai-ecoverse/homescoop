#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe jq

TB="$WORK/jq-$VER.tar.gz"
SRC="$WORK/jq-$VER"

homescoop_fetch "$URL" "$SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC"; fi
homescoop_extract "$TB" "$SRC"
homescoop_apply_patches "$SRC"

SLICC_A="$WORK/libslicc-cli.a"
homescoop_slicc_archive "$SLICC_A" cli

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=2097152 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain -lnodefs.js"
CLI_LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports) $SLICC_A"

if [[ ! -f "$SRC/jq" && ! -f "$SRC/jq.js" || -n "${FORCE:-}" ]]; then
  echo "== jq: emconfigure + emmake (builtin oniguruma)"
  (
    cd "$SRC"
    if [[ -f Makefile ]]; then make distclean >/dev/null 2>&1 || true; fi
    # vendor/oniguruma needs its own configure when builtin.
    if [[ -f vendor/oniguruma/configure ]]; then
      :
    elif [[ -f vendor/oniguruma/configure.ac ]]; then
      (cd vendor/oniguruma && autoreconf -fi) || true
    fi
    emconfigure ./configure \
      --build=x86_64-pc-linux-gnu --host=wasm32-unknown-emscripten \
      --with-oniguruma=builtin \
      --disable-shared --enable-static \
      --disable-docs --disable-maintainer-mode
    homescoop_fix_darwin_ar Makefile
    # Also fix AR in vendor oniguruma if present.
    [[ -f vendor/oniguruma/Makefile ]] && homescoop_fix_darwin_ar vendor/oniguruma/Makefile
    # shellcheck disable=SC2086
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
      LDFLAGS="$CLI_LDFLAGS"
  )
fi
if [[ -f "$SRC/jq.js" && ! -f "$SRC/jq" ]]; then mv "$SRC/jq.js" "$SRC/jq"; fi
test -f "$SRC/jq.wasm" || test -f "$SRC/jq"
homescoop_stage_cli "$SRC" jq
homescoop_stage_license "$SRC"/COPYING "$SRC"/LICENSE "$SRC"/COPYING.MIT
homescoop_notices_begin "jq.wasm statically links the following. (decNumber and the dtoa code are covered by jq's own LICENSE.)"
homescoop_notice "Oniguruma (vendored in jq $VERSION, --with-oniguruma=builtin)" \
  "$SRC"/vendor/oniguruma/COPYING - "$SRC"/vendor/oniguruma/AUTHORS -
homescoop_notice_emscripten
echo "== jq: staged → $HOMESCOOP_PKG/package"
