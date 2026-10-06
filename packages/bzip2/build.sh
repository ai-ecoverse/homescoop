#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe bzip2

TB="$WORK/bzip2-$VER.tar.gz"
SRC="$WORK/bzip2-$VER"

homescoop_fetch "$URL" "$SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC"; fi
homescoop_extract "$TB" "$SRC"
homescoop_apply_patches "$SRC"

SLICC_A="$WORK/libslicc-cli.a"
homescoop_slicc_archive "$SLICC_A" cli

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=524288 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain -lnodefs.js"
CLI_LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports) $SLICC_A"

if [[ ! -f "$SRC/bzip2" && ! -f "$SRC/bzip2.js" || -n "${FORCE:-}" ]]; then
  echo "== bzip2: emmake (manual Makefile)"
  (
    cd "$SRC"
    # Skip `test` (runs the wasm binary under make). Build lib + CLIs only.
    # shellcheck disable=SC2086
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
      CC=emcc AR=emar RANLIB=emranlib \
      CFLAGS="-O2 -D_FILE_OFFSET_BITS=64 -Wall" \
      LDFLAGS="$CLI_LDFLAGS" \
      libbz2.a bzip2 bzip2recover
  )
fi
if [[ -f "$SRC/bzip2.js" && ! -f "$SRC/bzip2" ]]; then mv "$SRC/bzip2.js" "$SRC/bzip2"; fi
if [[ -f "$SRC/bzip2recover.js" && ! -f "$SRC/bzip2recover" ]]; then mv "$SRC/bzip2recover.js" "$SRC/bzip2recover"; fi
test -f "$SRC/bzip2.wasm" || test -f "$SRC/bzip2"
test -f "$SRC/libbz2.a"
homescoop_stage_cli "$SRC" bzip2
homescoop_stage_cli "$SRC" bzip2recover
homescoop_stage_lib "$SRC/libbz2.a" libbz2.a
homescoop_stage_headers "$SRC/bzlib.h"
homescoop_write_pc bzip2 "$VER" "-lbz2"

# Shell helpers (need wasm-bash + wasm-grep/wasm-diffutils at runtime).
PKG_BIN="$HOMESCOOP_PKG/package/bin"
for s in bzgrep bzdiff; do
  if [[ -f "$SRC/$s" ]]; then
    cp "$SRC/$s" "$PKG_BIN/$s"
    chmod +x "$PKG_BIN/$s"
  fi
done

homescoop_stage_license "$SRC"/LICENSE "$SRC"/COPYING
echo "== bzip2: staged → $HOMESCOOP_PKG/package"
