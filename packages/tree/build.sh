#!/usr/bin/env bash
# tree — plain Makefile C program, compiled with emcc directly.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe tree

TB="$WORK/tree-$VERSION.tgz"
SRC="$WORK/tree-$VERSION"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC"; fi
homescoop_extract "$TB" "$SRC"
homescoop_apply_patches "$SRC"

SLICC_A="$WORK/libslicc-tree.a"
homescoop_slicc_archive "$SLICC_A" gaps

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=262144 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
CLI_LDFLAGS="$(homescoop_slicc_keep_exports) $(homescoop_em_cli_ldflags) -Wl,--whole-archive $SLICC_A -Wl,--no-whole-archive"

if [[ ! -f "$SRC/tree.wasm" || -n "${FORCE:-}" ]]; then
  echo "== tree: emcc"
  (
    cd "$SRC"
    rm -f ./*.o tree tree.js tree.wasm
    # Upstream's Makefile objects; compile them ourselves so CFLAGS/LDFLAGS
    # are not mixed with its gcc -Wdiscarded-qualifiers defaults.
    objs=()
    for c in color file filter hash html info json list tree unix util xml strverscmp; do
      emcc -O2 -std=c11 -DLARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64 -D_GNU_SOURCE \
        -c "$c.c" -o "$c.o"
      objs+=("$c.o")
    done
    # shellcheck disable=SC2086
    emcc -O2 -o tree.js "${objs[@]}" $CLI_LDFLAGS
  )
fi

if [[ -f "$SRC/tree.js" ]]; then mv "$SRC/tree.js" "$SRC/tree"; fi
test -f "$SRC/tree.wasm"
homescoop_stage_cli "$SRC" tree
homescoop_stage_license "$SRC"/LICENSE
echo "== tree: staged → $HOMESCOOP_PKG/package ($VERSION)"
