#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe file

TB="$WORK/file-$VER.tar.gz"
SRC="$WORK/file-$VER"

homescoop_fetch "$URL" "$SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC"; fi
homescoop_extract "$TB" "$SRC"
homescoop_apply_patches "$SRC"

SLICC_A="$WORK/libslicc-cli.a"
homescoop_slicc_archive "$SLICC_A" cli

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1048576 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain -lnodefs.js"
CLI_LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports) $SLICC_A"

# Prefer PREFIX libs from host-run deps (zlib, bzip2, xz).
export PKG_CONFIG_PATH="${PREFIX}/lib/pkgconfig:${PKG_CONFIG_PATH:-}"
export CPPFLAGS="-I${PREFIX}/include ${CPPFLAGS:-}"
export LDFLAGS="-L${PREFIX}/lib ${LDFLAGS:-}"

if [[ ! -f "$SRC/src/file" && ! -f "$SRC/src/file.js" || -n "${FORCE:-}" ]]; then
  echo "== file: emconfigure + emmake"
  (
    cd "$SRC"
    if [[ -f Makefile ]]; then make distclean >/dev/null 2>&1 || true; fi
    emconfigure ./configure \
      --build=x86_64-pc-linux-gnu --host=wasm32-unknown-emscripten \
      --disable-shared --enable-static \
      --enable-zlib --enable-bzlib --enable-xzlib \
      --disable-libseccomp \
      --datadir='${prefix}/share' \
      --prefix="$PREFIX" \
      CPPFLAGS="$CPPFLAGS" LDFLAGS="$LDFLAGS"
    homescoop_fix_darwin_ar Makefile
    # Cross: compile magic.mgc with a matching native file-5.46, not the
    # host OS `file` (macOS/Homebrew versions produce incompatible .mgc).
    NATIVE_FILE="${HOMESCOOP_FILE_COMPILE:-}"
    if [[ -z "$NATIVE_FILE" || ! -x "$NATIVE_FILE" ]]; then
      NF_ROOT="${HOMESCOOP_OUT:-$ROOT/.homescoop-out}/file-native"
      if [[ ! -x "$NF_ROOT/prefix/bin/file" ]]; then
        echo "== file: build native file-$VER for FILE_COMPILE"
        mkdir -p "$NF_ROOT"
        NTB="$WORK/file-$VER-native.tar.gz"
        # Reuse already-fetched tarball.
        cp "$TB" "$NTB"
        rm -rf "$NF_ROOT/src" && mkdir -p "$NF_ROOT/src"
        tar xzf "$NTB" -C "$NF_ROOT/src"
        (
          cd "$NF_ROOT/src/file-$VER"
          ./configure --disable-shared --enable-static --prefix="$NF_ROOT/prefix"
          make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
          make install
        )
      fi
      NATIVE_FILE="$NF_ROOT/prefix/bin/file"
    fi
    test -x "$NATIVE_FILE"
    echo "== file: FILE_COMPILE=$NATIVE_FILE ($("$NATIVE_FILE" --version | head -1))"
    # shellcheck disable=SC2086
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
      FILE_COMPILE="$NATIVE_FILE" \
      LDFLAGS="$CLI_LDFLAGS $LDFLAGS -lz -lbz2 -llzma"
  )
fi

STAGE="$SRC/src"
if [[ -f "$STAGE/file.js" && ! -f "$STAGE/file" ]]; then mv "$STAGE/file.js" "$STAGE/file"; fi
test -f "$STAGE/file.wasm" || test -f "$STAGE/file"
homescoop_stage_cli "$STAGE" file

# libmagic
LIB="$SRC/src/.libs/libmagic.a"
[[ -f "$LIB" ]] || LIB="$SRC/src/libmagic.a"
if [[ -f "$LIB" ]]; then
  homescoop_stage_lib "$LIB" libmagic.a
  homescoop_stage_headers "$SRC/src/magic.h"
  homescoop_write_pc libmagic "$VER" "-lmagic -lz -lbz2 -llzma"
fi

# magic.mgc
MGC="$SRC/magic/magic.mgc"
test -f "$MGC"
mkdir -p "$HOMESCOOP_PKG/package/share/misc"
cp "$MGC" "$HOMESCOOP_PKG/package/share/misc/magic.mgc"

homescoop_stage_license "$SRC"/COPYING "$SRC"/LICENSE
homescoop_notices_begin "file.wasm and lib/libmagic.a statically link the following."
homescoop_notice "zlib 1.3.1 (@ai-ecoverse/wasm-zlib)" \
  https://raw.githubusercontent.com/madler/zlib/v1.3.1/LICENSE 845efc77857d485d91fb3e0b884aaa929368c717ae8186b66fe1ed2495753243
homescoop_notice "bzip2 / libbzip2 1.0.8 (@ai-ecoverse/wasm-bzip2)" \
  https://gitlab.com/bzip2/bzip2/-/raw/bzip2-1.0.8/LICENSE c6dbbf828498be844a89eaa3b84adbab3199e342eb5cb2ed2f0d4ba7ec0f38a3
homescoop_notice "XZ Utils / liblzma 5.8.1 (@ai-ecoverse/wasm-xz; liblzma is 0BSD)" \
  https://raw.githubusercontent.com/tukaani-project/xz/v5.8.1/COPYING 616a3ad264ce29b8f1cb97e53037b139d406899ca8d1f799651e17bfa09830b8 \
  https://raw.githubusercontent.com/tukaani-project/xz/v5.8.1/COPYING.0BSD 0b01625d853911cd0e2e088dcfb743261034a091bb379246cb25a14cc4c74bf1
homescoop_notice_emscripten
echo "== file: staged → $HOMESCOOP_PKG/package"
