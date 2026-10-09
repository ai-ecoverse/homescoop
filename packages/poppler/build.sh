#!/usr/bin/env bash
# poppler: pdftotext, pdftoppm, pdfinfo, … as one multi-call wasm
# (emcmake, static libpoppler, Splash only, generic font configuration).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe poppler

TB="$WORK/poppler-$VERSION.tar.xz"
SRC="$WORK/poppler-$VERSION"
BLD="$WORK/poppler-build"
# Keep in step with HS_UTILS in multicall.patch.
UTILS=(pdftotext pdftoppm pdfinfo pdfimages pdffonts pdfseparate pdfunite pdfdetach pdfattach pdftops pdftohtml)

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC" "$BLD"; fi
homescoop_extract "$TB" "$SRC"
homescoop_apply_patches "$SRC"

for h in zlib.h jpeglib.h png.h lcms2.h ft2build.h openjpeg.h; do
  test -f "$PREFIX/include/$h" || { echo "missing $h in PREFIX=$PREFIX" >&2; exit 1; }
done

SLICC_A="$WORK/libslicc-poppler.a"
homescoop_slicc_archive "$SLICC_A" gaps
export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=2097152 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain -lnodefs.js"
# No -fwasm-exceptions: freetype and libpng from homescoop use emscripten
# setjmp/longjmp, which does not link with wasm sjlj.
EXE_LDFLAGS="$(homescoop_slicc_keep_exports) $(homescoop_em_cli_ldflags) -Wl,--whole-archive $SLICC_A -Wl,--no-whole-archive"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"

# wasm-openjpeg ships no CMake package; poppler wants find_package(OpenJPEG).
OJ_CMAKE="$WORK/openjpeg-cmake"
mkdir -p "$OJ_CMAKE"
cat >"$OJ_CMAKE/OpenJPEGConfig.cmake" <<EOF
set(OPENJPEG_MAJOR_VERSION 2)
set(OPENJPEG_INCLUDE_DIRS "$PREFIX/include")
if(NOT TARGET openjp2)
  add_library(openjp2 STATIC IMPORTED)
  set_target_properties(openjp2 PROPERTIES
    IMPORTED_LOCATION "$PREFIX/lib/libopenjp2.a"
    INTERFACE_INCLUDE_DIRECTORIES "$PREFIX/include")
endif()
EOF

if [[ ! -f "$BLD/utils/poppler-multicall.wasm" || -n "${FORCE:-}" ]]; then
  echo "== poppler: emcmake (static, Splash, generic fonts; deps from PREFIX)"
  rm -rf "$BLD"
  env PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig" PKG_CONFIG_PATH= \
    emcmake cmake -S "$SRC" -B "$BLD" -G "Unix Makefiles" \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_FIND_ROOT_PATH="$PREFIX" -DCMAKE_PREFIX_PATH="$PREFIX" \
      -DCMAKE_C_FLAGS="-O2" \
      -DCMAKE_CXX_FLAGS="-O2" \
      -DCMAKE_EXE_LINKER_FLAGS="$EXE_LDFLAGS" \
      -DBUILD_SHARED_LIBS=OFF -DHOMESCOOP_MULTICALL=ON \
      -DFONT_CONFIGURATION=generic \
      -DENABLE_UTILS=ON -DENABLE_CPP=OFF -DENABLE_GLIB=OFF \
      -DENABLE_GOBJECT_INTROSPECTION=OFF -DENABLE_QT5=OFF -DENABLE_QT6=OFF \
      -DENABLE_BOOST=OFF -DENABLE_BROTLI=OFF -DENABLE_LIBOPENJPEG=ON -DOpenJPEG_DIR="$OJ_CMAKE" \
      -DENABLE_LIBCURL=OFF -DENABLE_LIBTIFF=OFF -DENABLE_NSS3=OFF \
      -DENABLE_GPGME=OFF -DENABLE_HARFBUZZ=OFF -DENABLE_LCMS=ON \
      -DENABLE_LIBJPEG=ON -DWITH_Cairo=OFF -DWITH_GLIB=OFF \
      -DBUILD_MANUAL_TESTS=OFF -DBUILD_GTK_TESTS=OFF -DBUILD_QT5_TESTS=OFF \
      -DBUILD_QT6_TESTS=OFF -DBUILD_CPP_TESTS=OFF -DRUN_GPERF_IF_PRESENT=OFF \
      -DTESTDATADIR=/nonexistent \
      -DFREETYPE_INCLUDE_DIRS="$PREFIX/include" -DFREETYPE_LIBRARY="$PREFIX/lib/libfreetype.a" \
      -DZLIB_INCLUDE_DIR="$PREFIX/include" -DZLIB_LIBRARY="$PREFIX/lib/libz.a" \
      -DJPEG_INCLUDE_DIR="$PREFIX/include" -DJPEG_LIBRARY="$PREFIX/lib/libjpeg.a" \
      -DPNG_PNG_INCLUDE_DIR="$PREFIX/include" -DPNG_LIBRARY="$PREFIX/lib/libpng16.a" \
      -DLCMS2_INCLUDE_DIR="$PREFIX/include" -DLCMS2_LIBRARIES="$PREFIX/lib/liblcms2.a"
  emmake make -C "$BLD" -j"$JOBS" poppler-multicall
fi

test -f "$BLD/utils/poppler-multicall.wasm"
if [[ -f "$BLD/utils/poppler-multicall.js" ]]; then
  mv "$BLD/utils/poppler-multicall.js" "$BLD/utils/poppler-multicall"
fi
homescoop_stage_cli "$BLD/utils" poppler-multicall

# Base-14 fonts for Splash (no fontconfig): POPPLER_FONTSDIR → share/fonts.
homescoop_load_recipe poppler --source gsfonts
FTB="$WORK/gsfonts-$GSFONTS_VERSION.tar.gz"
homescoop_fetch "$GSFONTS_SRC_URL" "$GSFONTS_SRC_SHA" "$FTB"
FSRC="$WORK/gsfonts-src"
rm -rf "$FSRC" && mkdir -p "$FSRC"
tar xzf "$FTB" -C "$FSRC" --strip-components=1
FONTS="$HOMESCOOP_PKG/package/share/fonts"
rm -rf "$FONTS" && mkdir -p "$FONTS"
for f in n022003l n022004l n022024l n022023l n019003l n019004l n019024l n019023l \
         s050000l n021004l n021024l n021023l n021003l d050000l; do
  cp "$FSRC/$f.pfb" "$FONTS/"
done
cp "$FSRC/COPYING" "$FONTS/COPYING"
cp "$FSRC/README" "$FONTS/README"

homescoop_stage_license "$SRC"/COPYING
homescoop_notices_begin "poppler-multicall.wasm statically links the following, and share/fonts holds the URW base-14 fonts."
homescoop_notice "zlib 1.3.1 (@ai-ecoverse/wasm-zlib)" \
  https://raw.githubusercontent.com/madler/zlib/v1.3.1/LICENSE 845efc77857d485d91fb3e0b884aaa929368c717ae8186b66fe1ed2495753243
homescoop_notice "libjpeg-turbo 3.1.2 (@ai-ecoverse/wasm-libjpeg-turbo)" \
  https://raw.githubusercontent.com/libjpeg-turbo/libjpeg-turbo/3.1.2/LICENSE.md 2189dc45a8fe96204069f8124caa53a148dfdc193f50f584c6ca7849a6072872 \
  https://raw.githubusercontent.com/libjpeg-turbo/libjpeg-turbo/3.1.2/README.ijg 75815e3bf6484201a3c3d17a1bbf10f2e8e3237f84df10a2357ea896db2a81d6
homescoop_notice "libpng 1.6.59 (@ai-ecoverse/wasm-libpng)" \
  https://raw.githubusercontent.com/pnggroup/libpng/v1.6.59/LICENSE bdb0a645ea18c60507d0368379b1ac5474b92255fcc2d115e07486a7672ba526
homescoop_notice "Little CMS 2.19.1 (@ai-ecoverse/wasm-lcms2)" \
  https://raw.githubusercontent.com/mm2/Little-CMS/lcms2.19.1/LICENSE 6dbd60437f8ef91d8de1f08ad75882547fd4931bfcc3566a0735f28db1484d31
homescoop_notice "FreeType 2.13.3 (@ai-ecoverse/wasm-freetype), used under the FreeType License" \
  https://raw.githubusercontent.com/freetype/freetype/VER-2-13-3/LICENSE.TXT 2e3bbb7d7c5c396368dd0853a790ec29ce5b8647163dde42a0493fb0d6556b2b \
  https://raw.githubusercontent.com/freetype/freetype/VER-2-13-3/docs/FTL.TXT 08c135755dd589039470f1fdbb400daaabaaa50d0b366d19cebff4d22986baa1
homescoop_notice "OpenJPEG 2.5.3 (@ai-ecoverse/wasm-openjpeg)" \
  https://raw.githubusercontent.com/uclouvain/openjpeg/v2.5.3/LICENSE a6af136f3e15038a666b61f376612a07d9a4e48cb7c01adbf3e33b3f14ab49b6
homescoop_notice "URW base-14 Type1 fonts, gsfonts $GSFONTS_VERSION (share/fonts)" \
  "$FSRC/README" - "$FSRC/COPYING" -
homescoop_notice_emscripten
echo "== poppler: staged → $HOMESCOOP_PKG/package ($VERSION, utils: ${UTILS[*]})"
