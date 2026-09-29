#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe gzip

TB="$WORK/gzip-$VER.tar.gz"
SRC="$WORK/gzip-$VER"

homescoop_fetch "$URL" "$SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC"; fi
homescoop_extract "$TB" "$SRC"

SLICC_A="$WORK/libslicc-cli.a"
homescoop_slicc_archive "$SLICC_A" cli

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=524288 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
CLI_LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports)"
export ac_cv_func_getcwd=yes ac_cv_func_sigaction=yes

if [[ ! -f "$SRC/gzip" && ! -f "$SRC/gzip.js" || -n "${FORCE:-}" ]]; then
  echo "== gzip: emconfigure + emmake"
  (
    cd "$SRC"
    if [[ -f Makefile ]]; then make distclean >/dev/null 2>&1 || true; fi
    # GNU_STANDARD=1 (default) ignores argv[0]; gunzip/zcat need =0 to decompress.
    emconfigure ./configure --host=wasm32-unknown-emscripten --disable-nls \
      CFLAGS="-O2 -DGNU_STANDARD=0"
    homescoop_fix_darwin_ar Makefile
    # shellcheck disable=SC2086
    # Full make (not just `gzip`): needs lib/libgzip.a + generated version.h first.
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
      CFLAGS="-O2 -DGNU_STANDARD=0" \
      LDFLAGS="$SLICC_A $CLI_LDFLAGS"
  )
fi
if [[ -f "$SRC/gzip.js" && ! -f "$SRC/gzip" ]]; then mv "$SRC/gzip.js" "$SRC/gzip"; fi
test -f "$SRC/gzip.wasm" || test -f "$SRC/gzip"
homescoop_stage_cli "$SRC" gzip
homescoop_stage_license "$SRC"/COPYING "$SRC"/LICENSE
echo "== gzip: staged → $HOMESCOOP_PKG/package"
