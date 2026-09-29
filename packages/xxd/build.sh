#!/usr/bin/env bash
# xxd from vim's standalone xxd.c.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe xxd

SRC_C="$WORK/xxd-${VER}.c"
OUT="$WORK/xxd-cli"

homescoop_fetch "$URL" "$SHA" "$SRC_C"
mkdir -p "$OUT"
cp "$SRC_C" "$OUT/xxd.c"

SLICC_A="$WORK/libslicc-cli.a"
homescoop_slicc_archive "$SLICC_A" cli

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=262144 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
CLI_LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports)"

if [[ ! -f "$OUT/xxd.wasm" || -n "${FORCE:-}" ]]; then
  echo "== xxd: emcc xxd.c"
  # shellcheck disable=SC2086
  emcc -O2 -DUNIX "$OUT/xxd.c" -o "$OUT/xxd" "$SLICC_A" $CLI_LDFLAGS
fi
if [[ -f "$OUT/xxd.js" && ! -f "$OUT/xxd" ]]; then
  mv "$OUT/xxd.js" "$OUT/xxd"
fi
test -f "$OUT/xxd.wasm"
homescoop_stage_cli "$OUT" xxd
# xxd ships as a single .c from vim; keep package/LICENSE (Vim license excerpt).
homescoop_stage_license "$HOMESCOOP_PKG/package/LICENSE"
echo "== xxd: staged → $HOMESCOOP_PKG/package ($VER)"
