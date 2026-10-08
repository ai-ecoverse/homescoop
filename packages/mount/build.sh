#!/usr/bin/env bash
# mount / umount — in-tree minimal pair over slicc-kernel process mounts.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
# No upstream source, so not homescoop_load_recipe (it requires source.url).
HOMESCOOP_PKG="$ROOT/packages/mount"
VERSION="$(node "$ROOT/scripts/read-recipe.mjs" mount --field version)"
WORK="${WORK:-$HOMESCOOP_PKG/.work}"
OBJ="$WORK/mount-$VERSION"
mkdir -p "$OBJ"

SLICC_A="$WORK/libslicc-mount.a"
homescoop_slicc_archive "$SLICC_A" mount

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=262144 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
# shellcheck disable=SC2207
CLI_LDFLAGS=($(homescoop_slicc_keep_exports) $(homescoop_em_cli_ldflags))

for prog in mount umount; do
  echo "== mount: emcc $prog"
  emcc -O2 -Wall -Wextra -Werror -DPACKAGE_VERSION="\"$VERSION\"" \
    "$HOMESCOOP_PKG/src/$prog.c" "$HOMESCOOP_PKG/src/mnt.c" \
    "${CLI_LDFLAGS[@]}" \
    -Wl,--whole-archive "$SLICC_A" -Wl,--no-whole-archive \
    -o "$OBJ/$prog.js"
  mv "$OBJ/$prog.js" "$OBJ/$prog"
  test -f "$OBJ/$prog.wasm"
  homescoop_stage_cli "$OBJ" "$prog"
done
homescoop_stage_license "$ROOT/LICENSE"
echo "== mount: staged → $HOMESCOOP_PKG/package ($VERSION)"
