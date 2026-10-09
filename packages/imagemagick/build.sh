#!/usr/bin/env bash
# ImageMagick 7.1.2-32 utilities/magick — port of slicc-emscripten harness/ladder.sh rung_magick.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe imagemagick

TB="$WORK/ImageMagick-${VER}.tar.gz"
SRC="$WORK/ImageMagick-${VER}"

homescoop_fetch "$URL" "$SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC"; fi
homescoop_extract "$TB" "$SRC"
test -f "$SRC/configure"

SLICC_A="$WORK/libslicc-cli.a"
homescoop_slicc_archive "$SLICC_A" cli

# Delegate libs were unpacked into PREFIX by host-run.sh.
export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig"
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"
unset PKG_CONFIG_SYSROOT_DIR || true
# Prefer host pkg-config; emconfigure otherwise resets LIBDIR to the sysroot.
if command -v pkg-config >/dev/null 2>&1; then
  export PKG_CONFIG="$(command -v pkg-config)"
elif command -v pkgconf >/dev/null 2>&1; then
  export PKG_CONFIG="$(command -v pkgconf)"
else
  echo "homescoop: need host pkg-config/pkgconf to find wasm delegates" >&2
  exit 1
fi
export EM_PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"

echo "== imagemagick: pkg-config delegates"
"$PKG_CONFIG" --modversion zlib libjpeg libpng lcms2 libtiff-4 libwebp \
  libwebpmux libwebpdemux libopenjp2 freetype2 | tr '\n' ' '
echo

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1048576 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
CLI_LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports)"

# -g1 not -g: stock LLVM can segfault on coders/png.c with full debug + exceptions
# (same note as ladder.sh rung_magick).
if [[ ! -f "$SRC/utilities/magick" && ! -f "$SRC/utilities/magick.js" || -n "${FORCE:-}" ]]; then
  echo "== imagemagick: emconfigure"
  (
    cd "$SRC"
    if [[ -f Makefile ]]; then
      make distclean >/dev/null 2>&1 || true
    fi
    PKG_CONFIG="$PKG_CONFIG" EM_PKG_CONFIG_PATH="$EM_PKG_CONFIG_PATH" \
      PKG_CONFIG_LIBDIR="$PKG_CONFIG_LIBDIR" \
      emconfigure ./configure --host=wasm32-unknown-emscripten \
        --disable-shared --enable-static --disable-openmp --without-threads \
        --without-modules --disable-docs --without-perl --without-magick-plus-plus \
        --without-x --without-bzlib --without-djvu --without-dps --without-fftw \
        --without-flif --without-fpx --without-fontconfig --without-gslib \
        --without-gvc --without-heic --without-jbig --without-jxl --without-lqr \
        --without-lzma --without-openexr --without-pango --without-raqm \
        --without-raw --without-rsvg --without-uhdr --without-wmf --without-xml \
        --without-zip --without-zstd \
        CFLAGS="-g1 -O2" \
        LDFLAGS="-L$PREFIX/lib"
    homescoop_fix_darwin_ar Makefile
    find . -name Makefile -print0 | while IFS= read -r -d '' mf; do
      homescoop_fix_darwin_ar "$mf"
    done
    echo "== imagemagick: emmake utilities/magick"
    # shellcheck disable=SC2086
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
      utilities/magick \
      LDFLAGS="-L$PREFIX/lib $SLICC_A $CLI_LDFLAGS"
  )
fi

MAGICK_BIN=""
for c in "$SRC/utilities/magick" "$SRC/utilities/magick.js"; do
  if [[ -f "$c" ]]; then MAGICK_BIN="$c"; break; fi
done
test -n "$MAGICK_BIN"
# Normalize to bare name next to .wasm
UTIL="$SRC/utilities"
if [[ -f "$UTIL/magick.js" && ! -f "$UTIL/magick" ]]; then
  mv "$UTIL/magick.js" "$UTIL/magick"
fi
test -f "$UTIL/magick.wasm"
homescoop_stage_cli "$UTIL" magick

# Ship XML configure files; package.json sets MAGICK_CONFIGURE_PATH → etc/ImageMagick-7.
CFG_DEST="$HOMESCOOP_PKG/package/etc/ImageMagick-7"
mkdir -p "$CFG_DEST"
if [[ -d "$SRC/config" ]]; then
  find "$SRC/config" -maxdepth 1 -name '*.xml' -exec cp {} "$CFG_DEST/" \;
fi
test -f "$CFG_DEST/colors.xml"

# argv0 aliases are declared in package.json (convert/identify/mogrify → magick).
homescoop_stage_license "$SRC"/LICENSE "$SRC"/COPYING "$SRC"/Copyright.txt
homescoop_notices_begin "magick.wasm statically links the following delegate libraries (no MPEG-family codec; video formats would need an external ffmpeg, which is not shipped)."
homescoop_notice "zlib 1.3.1 (@ai-ecoverse/wasm-zlib)" \
  https://raw.githubusercontent.com/madler/zlib/v1.3.1/LICENSE 845efc77857d485d91fb3e0b884aaa929368c717ae8186b66fe1ed2495753243
homescoop_notice "libjpeg-turbo 3.1.2 (@ai-ecoverse/wasm-libjpeg-turbo)" \
  https://raw.githubusercontent.com/libjpeg-turbo/libjpeg-turbo/3.1.2/LICENSE.md 2189dc45a8fe96204069f8124caa53a148dfdc193f50f584c6ca7849a6072872 \
  https://raw.githubusercontent.com/libjpeg-turbo/libjpeg-turbo/3.1.2/README.ijg 75815e3bf6484201a3c3d17a1bbf10f2e8e3237f84df10a2357ea896db2a81d6
homescoop_notice "libpng 1.6.59 (@ai-ecoverse/wasm-libpng)" \
  https://raw.githubusercontent.com/pnggroup/libpng/v1.6.59/LICENSE bdb0a645ea18c60507d0368379b1ac5474b92255fcc2d115e07486a7672ba526
homescoop_notice "Little CMS 2.19.1 (@ai-ecoverse/wasm-lcms2)" \
  https://raw.githubusercontent.com/mm2/Little-CMS/lcms2.19.1/LICENSE 6dbd60437f8ef91d8de1f08ad75882547fd4931bfcc3566a0735f28db1484d31
homescoop_notice "LibTIFF 4.7.2 (@ai-ecoverse/wasm-libtiff)" \
  https://gitlab.com/libtiff/libtiff/-/raw/v4.7.2/LICENSE.md 0e27c2382d7b8147972bbb746e04059a1152c8d0fda9d03ef1399d1a433c4ade
homescoop_notice "libwebp 1.5.0 (@ai-ecoverse/wasm-libwebp)" \
  https://raw.githubusercontent.com/webmproject/libwebp/v1.5.0/COPYING 5aec868f669e384a22372a4e8a1a6cd7d44c64cd451f960ca69cc170d1e13acf \
  https://raw.githubusercontent.com/webmproject/libwebp/v1.5.0/PATENTS cc3273e0694ea5896145e0677699b53471b03ea43021ddc50e7923fbb9f5023c
homescoop_notice "OpenJPEG 2.5.3 (@ai-ecoverse/wasm-openjpeg)" \
  https://raw.githubusercontent.com/uclouvain/openjpeg/v2.5.3/LICENSE a6af136f3e15038a666b61f376612a07d9a4e48cb7c01adbf3e33b3f14ab49b6
homescoop_notice "FreeType 2.13.3 (@ai-ecoverse/wasm-freetype), used under the FreeType License" \
  https://raw.githubusercontent.com/freetype/freetype/VER-2-13-3/LICENSE.TXT 2e3bbb7d7c5c396368dd0853a790ec29ce5b8647163dde42a0493fb0d6556b2b \
  https://raw.githubusercontent.com/freetype/freetype/VER-2-13-3/docs/FTL.TXT 08c135755dd589039470f1fdbb400daaabaaa50d0b366d19cebff4d22986baa1
homescoop_notice_emscripten
echo "== imagemagick: staged → $HOMESCOOP_PKG/package ($VER) + etc/ImageMagick-7"
