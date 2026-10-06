#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe xz

TB="$WORK/xz-$VER.tar.xz"
SRC="$WORK/xz-$VER"

homescoop_fetch "$URL" "$SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC"; fi
homescoop_extract "$TB" "$SRC"
homescoop_apply_patches "$SRC"

SLICC_A="$WORK/libslicc-cli.a"
homescoop_slicc_archive "$SLICC_A" cli

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1048576 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain -lnodefs.js"
CLI_LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports) $SLICC_A"

if [[ ! -f "$SRC/src/xz/xz" && ! -f "$SRC/src/xz/xz.js" || -n "${FORCE:-}" ]]; then
  echo "== xz: emconfigure + emmake"
  (
    cd "$SRC"
    if [[ -f Makefile ]]; then make distclean >/dev/null 2>&1 || true; fi
    emconfigure ./configure \
      --build=x86_64-pc-linux-gnu --host=wasm32-unknown-emscripten \
      --disable-shared --enable-static --disable-threads \
      --disable-nls --disable-doc --disable-scripts \
      --prefix="$PREFIX"
    homescoop_fix_darwin_ar Makefile
    # shellcheck disable=SC2086
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
      LDFLAGS="$CLI_LDFLAGS"
  )
fi

XZ_BIN="$SRC/src/xz"
if [[ -f "$XZ_BIN/xz.js" && ! -f "$XZ_BIN/xz" ]]; then mv "$XZ_BIN/xz.js" "$XZ_BIN/xz"; fi
test -f "$XZ_BIN/xz.wasm" || test -f "$XZ_BIN/xz"
homescoop_stage_cli "$XZ_BIN" xz

# liblzma
LIB="$SRC/src/liblzma/.libs/liblzma.a"
[[ -f "$LIB" ]] || LIB="$SRC/src/liblzma/liblzma.a"
test -f "$LIB"
homescoop_stage_lib "$LIB" liblzma.a
# Headers: install via make DESTDIR or copy api/
mkdir -p "$HOMESCOOP_PKG/package/include/lzma" "$PREFIX/include/lzma"
cp "$SRC"/src/liblzma/api/lzma.h "$HOMESCOOP_PKG/package/include/"
cp "$SRC"/src/liblzma/api/lzma.h "$PREFIX/include/"
cp "$SRC"/src/liblzma/api/lzma/*.h "$HOMESCOOP_PKG/package/include/lzma/"
cp "$SRC"/src/liblzma/api/lzma/*.h "$PREFIX/include/lzma/"
homescoop_write_pc liblzma "$VER" "-llzma"

# Configure scripts were disabled; generate from .in with sed.
PKG_BIN="$HOMESCOOP_PKG/package/bin"
for s in xzgrep xzdiff xzless; do
  src_in="$SRC/src/scripts/${s}.in"
  if [[ -f "$src_in" ]]; then
    # Minimal @VAR@ substitution for a relocatable script.
    sed -e 's|@POSIX_SHELL@|/bin/sh|g' \
        -e 's|@PACKAGE_NAME@|XZ Utils|g' \
        -e "s|@VERSION@|$VER|g" \
        -e 's|@enable_path_for_scripts@||g' \
        -e 's|@XZ@|xz|g' \
        -e 's|@XZDEC@|xz|g' \
        "$src_in" > "$PKG_BIN/$s"
    chmod +x "$PKG_BIN/$s"
  fi
done

homescoop_stage_license "$SRC"/COPYING "$SRC"/LICENSE "$SRC"/COPYING.0BSD
echo "== xz: staged → $HOMESCOOP_PKG/package"
