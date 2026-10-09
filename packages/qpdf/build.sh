#!/usr/bin/env bash
# qpdf: qpdf, fix-qdf, zlib-flate (emcmake, static libqpdf, native crypto).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe qpdf

TB="$WORK/qpdf-$VERSION.tar.gz"
SRC="$WORK/qpdf-$VERSION"
BLD="$WORK/qpdf-build"
PROGS=(qpdf fix-qdf zlib-flate)

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC" "$BLD"; fi
homescoop_extract "$TB" "$SRC"
homescoop_apply_patches "$SRC"

test -f "$PREFIX/include/zlib.h" || { echo "missing zlib in PREFIX=$PREFIX" >&2; exit 1; }
test -f "$PREFIX/include/jpeglib.h" || { echo "missing jpeg in PREFIX=$PREFIX" >&2; exit 1; }

SLICC_A="$WORK/libslicc-qpdf.a"
homescoop_slicc_archive "$SLICC_A" gaps
# qpdf recurses deeply on nested PDF objects; 1 MiB matches binutils.
export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1048576 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain -lnodefs.js"
EXE_LDFLAGS="$(homescoop_slicc_keep_exports) $(homescoop_em_cli_ldflags) -fwasm-exceptions -Wl,--whole-archive $SLICC_A -Wl,--no-whole-archive"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"

if [[ ! -f "$BLD/qpdf/qpdf.wasm" || -n "${FORCE:-}" ]]; then
  echo "== qpdf: emcmake (static, native crypto, zlib/jpeg from PREFIX)"
  rm -rf "$BLD"
  # Point the find_path/find_library fallbacks at PREFIX and keep
  # pkg-config from picking up host .pc files.
  env PKG_CONFIG_LIBDIR=/nonexistent PKG_CONFIG_PATH= \
    emcmake cmake -S "$SRC" -B "$BLD" -G "Unix Makefiles" \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_C_FLAGS="-O2 -fwasm-exceptions" \
      -DCMAKE_CXX_FLAGS="-O2 -fwasm-exceptions" \
      -DCMAKE_EXE_LINKER_FLAGS="$EXE_LDFLAGS" \
      -DBUILD_SHARED_LIBS=OFF -DBUILD_STATIC_LIBS=ON \
      -DUSE_IMPLICIT_CRYPTO=OFF -DREQUIRE_CRYPTO_NATIVE=ON \
      -DBUILD_DOC=OFF -DINSTALL_EXAMPLES=OFF -DSTATIC_JPEG=ON \
      -DZLIB_H_PATH="$PREFIX/include" -DZLIB_LIB_PATH="$PREFIX/lib/libz.a" \
      -DLIBJPEG_H_PATH="$PREFIX/include" -DLIBJPEG_LIB_PATH="$PREFIX/lib/libjpeg.a"
  emmake make -C "$BLD" -j"$JOBS" "${PROGS[@]}"
fi

for p in "${PROGS[@]}"; do
  dir="$BLD/qpdf"
  [[ "$p" == zlib-flate ]] && dir="$BLD/zlib-flate"
  test -f "$dir/$p.wasm"
  homescoop_stage_cli "$dir" "$p"
done
homescoop_stage_license "$SRC"/LICENSE.txt "$SRC"/NOTICE.md
homescoop_notices_begin "The qpdf, fix-qdf and zlib-flate wasm modules statically link the following."
homescoop_notice "zlib 1.3.1 (@ai-ecoverse/wasm-zlib)" \
  https://raw.githubusercontent.com/madler/zlib/v1.3.1/LICENSE 845efc77857d485d91fb3e0b884aaa929368c717ae8186b66fe1ed2495753243
homescoop_notice "libjpeg-turbo 3.1.2 (@ai-ecoverse/wasm-libjpeg-turbo)" \
  https://raw.githubusercontent.com/libjpeg-turbo/libjpeg-turbo/3.1.2/LICENSE.md 2189dc45a8fe96204069f8124caa53a148dfdc193f50f584c6ca7849a6072872 \
  https://raw.githubusercontent.com/libjpeg-turbo/libjpeg-turbo/3.1.2/README.ijg 75815e3bf6484201a3c3d17a1bbf10f2e8e3237f84df10a2357ea896db2a81d6
homescoop_notice_emscripten
echo "== qpdf: staged → $HOMESCOOP_PKG/package ($VERSION)"
