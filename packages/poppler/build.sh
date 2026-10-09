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
echo "== poppler: staged → $HOMESCOOP_PKG/package ($VERSION, utils: ${UTILS[*]})"
