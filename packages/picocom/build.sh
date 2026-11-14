#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe picocom

SRC_DIR="$WORK/picocom-$VERSION"
TARBALL="$WORK/picocom-$VERSION.tar.gz"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"
homescoop_apply_patches "$SRC_DIR"
grep -q '^VERSION = '"$VERSION"'$' "$SRC_DIR/Makefile" \
  || { echo "picocom: Makefile VERSION is not $VERSION" >&2; exit 1; }

SLICC_A="$WORK/libslicc-picocom.a"
homescoop_slicc_archive "$SLICC_A" less

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1048576 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
CLI_LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports) $(homescoop_slicc_wrap_pwd)"

DEFS=(
  "-DVERSION_STR=\"$VERSION\""
  -DTTY_Q_SZ=0
  -DHIGH_BAUD
  -DNO_FORK
  -DNO_CUSTOM_BAUD
  -DUSE_IOCTL
  -Dselect=homescoop_picocom_select
)
OBJS=(picocom term fdio split custbaud termios2 custbaud_bsd)

echo "== picocom: emcc ${DEFS[*]}"
(
  cd "$SRC_DIR"
  rm -f picocom picocom.js picocom.wasm ./*.o
  for o in "${OBJS[@]}"; do
    emcc -O2 -Wall "${DEFS[@]}" -c "$o.c" -o "$o.o"
  done
  read -ra LINK <<<"$CLI_LDFLAGS"
  emcc -O2 -Wall -c "$HOMESCOOP_PKG/em-select.c" -o em-select.o
  emcc -O2 -o picocom.js "${OBJS[@]/%/.o}" em-select.o "$SLICC_A" "${LINK[@]}"
)
test -f "$SRC_DIR/picocom.js"
test -f "$SRC_DIR/picocom.wasm"
homescoop_stage_cli "$SRC_DIR" picocom
cmp -s "$SRC_DIR/LICENSE.txt" "$HOMESCOOP_PKG/package/LICENSE" \
  || { echo "picocom: package/LICENSE is not upstream's LICENSE.txt" >&2; exit 1; }
homescoop_notices_begin "picocom.wasm is picocom $VERSION (GPL-2.0-or-later; see LICENSE), built with these flags: ${DEFS[*]}. It statically links the following."
homescoop_notice_emscripten
for prefix in "$SRC_DIR" "$WORK" "$HOME" "$ROOT" "/Users/runner" "/home/runner"; do
  if grep -qaF "$prefix" "$HOMESCOOP_PKG/package/bin/picocom.wasm"; then
    echo "picocom: host path $prefix leaked into picocom.wasm" >&2
    exit 1
  fi
done
shasum -a 256 "$HOMESCOOP_PKG/package/bin/picocom" "$HOMESCOOP_PKG/package/bin/picocom.wasm"
echo "== picocom: staged → $HOMESCOOP_PKG/package"
