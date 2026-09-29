#!/usr/bin/env bash
# sqlite3 CLI from the amalgamation (sqlite3.c + shell.c).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe sqlite3

TB="$WORK/sqlite-amalgamation-${AMAL}.zip"
SRC="$WORK/sqlite-amalgamation-${AMAL}"
OUT="$WORK/sqlite3-cli"

homescoop_fetch "$URL" "$SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC" "$OUT"; fi
homescoop_extract "$TB" "$SRC"
test -f "$SRC/sqlite3.c" && test -f "$SRC/shell.c"

SLICC_A="$WORK/libslicc-cli.a"
homescoop_slicc_archive "$SLICC_A" cli

mkdir -p "$OUT"
export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1048576 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
CLI_LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports)"

# Feature set mirrors a useful desktop CLI without loadable extensions
# (dlopen is a poor fit in the wasm realm).
CFLAGS=(
  -O2
  -DSQLITE_ENABLE_FTS5
  -DSQLITE_ENABLE_RTREE
  -DSQLITE_ENABLE_DBSTAT_VTAB
  -DSQLITE_ENABLE_MATH_FUNCTIONS
  -DSQLITE_ENABLE_COLUMN_METADATA
  -DSQLITE_OMIT_LOAD_EXTENSION
  -DSQLITE_THREADSAFE=1
  -DHAVE_READLINE=0
  -DHAVE_EDITLINE=0
)

if [[ ! -f "$OUT/sqlite3.wasm" || -n "${FORCE:-}" ]]; then
  echo "== sqlite3: emcc shell.c + sqlite3.c"
  # shellcheck disable=SC2086
  # Output basename without .js so package/bin/sqlite3 matches slicc.commands glue
  # (same layout as wasm-less / wasm-bash).
  emcc "${CFLAGS[@]}" "$SRC/shell.c" "$SRC/sqlite3.c" \
    -o "$OUT/sqlite3" \
    "$SLICC_A" $CLI_LDFLAGS
fi
test -f "$OUT/sqlite3.wasm"
test -f "$OUT/sqlite3" || test -f "$OUT/sqlite3.js"
# Normalize emcc's optional .js suffix to the bare command name.
if [[ -f "$OUT/sqlite3.js" && ! -f "$OUT/sqlite3" ]]; then
  mv "$OUT/sqlite3.js" "$OUT/sqlite3"
fi
homescoop_stage_cli "$OUT" sqlite3
homescoop_stage_license "$SRC"/COPYING "$SRC"/LICENSE "$SRC_DIR"/COPYING "$SRC_DIR"/LICENSE
echo "== sqlite3: staged → $HOMESCOOP_PKG/package ($VER)"
