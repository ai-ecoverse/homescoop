#!/usr/bin/env bash
# Magick.Native Q8 wasm — port of slicc-emscripten harness/ladder.sh
# rung_imq8 → rung_deps → rung_native.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe magick-native
homescoop_load_recipe magick-native --source imagemagick

MN_VER="$VERSION"
IM_COMMIT="$IMAGEMAGICK_VER"
MN_TB="$WORK/Magick.Native-${MN_VER}.tar.gz"
IM_TB="$WORK/ImageMagick-${IM_COMMIT}.tar.gz"
MN_SRC="$WORK/Magick.Native-${MN_VER}"
IM_SRC="$WORK/ImageMagick-${IM_COMMIT}"
Q8="$WORK/im-q8"
DEPS="$WORK/magick-deps"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$MN_TB"
homescoop_fetch "$IMAGEMAGICK_URL" "$IMAGEMAGICK_SHA" "$IM_TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$MN_SRC" "$IM_SRC" "$Q8"; fi
homescoop_extract "$MN_TB" "$MN_SRC"
homescoop_extract "$IM_TB" "$IM_SRC"
test -f "$IM_SRC/configure"
test -d "$MN_SRC/src/Magick.Native"

export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig"
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"
unset PKG_CONFIG_SYSROOT_DIR || true
if command -v pkg-config >/dev/null 2>&1; then
  export PKG_CONFIG="$(command -v pkg-config)"
elif command -v pkgconf >/dev/null 2>&1; then
  export PKG_CONFIG="$(command -v pkgconf)"
else
  echo "homescoop: need host pkg-config/pkgconf" >&2
  exit 1
fi
export EM_PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"

echo "== magick-native: pkg-config delegates"
"$PKG_CONFIG" --modversion zlib libjpeg libpng lcms2 libtiff-4 libwebp \
  libwebpmux libwebpdemux libopenjp2 freetype2 libxml-2.0 | tr '\n' ' '
echo

if [[ ! -f "$Q8/lib/libMagickCore-7.Q8.a" || -n "${FORCE:-}" ]]; then
  echo "== magick-native: ImageMagick Q8 (no HDRI, no utilities)"
  rm -rf "$Q8"
  mkdir -p "$Q8"
  (
    cd "$IM_SRC"
    if [[ -f Makefile ]]; then
      make distclean >/dev/null 2>&1 || true
    fi
    PKG_CONFIG="$PKG_CONFIG" EM_PKG_CONFIG_PATH="$EM_PKG_CONFIG_PATH" \
      PKG_CONFIG_LIBDIR="$PKG_CONFIG_LIBDIR" \
      CFLAGS="-O3 -Wall -DNDEBUG -m32" CXXFLAGS="-O3 -Wall -DNDEBUG -m32" \
      emconfigure ./configure --host=wasm32-unknown-emscripten \
        --disable-shared --disable-opencl --disable-dpc \
        --disable-assert --disable-deprecated --enable-static --enable-delegate-build \
        --without-magick-plus-plus --without-utilities --disable-docs \
        --without-x --without-perl --without-python --with-quantum-depth=8 \
        --enable-hdri=no --disable-openmp --without-threads --without-lzma \
        --without-bzlib --without-djvu --without-dps --without-fftw --without-flif \
        --without-fpx --without-fontconfig --without-gslib --without-gvc \
        --without-heic --without-jbig --without-jxl --without-lqr --without-openexr \
        --without-pango --without-raqm --without-raw --without-rsvg --without-uhdr \
        --without-wmf --without-zip --without-zstd \
        --prefix="$Q8" \
        LDFLAGS="-L$PREFIX/lib"
    homescoop_fix_darwin_ar Makefile
    find . -name Makefile -print0 | while IFS= read -r -d '' mf; do
      homescoop_fix_darwin_ar "$mf"
    done
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" install
  )
fi
test -f "$Q8/lib/libMagickCore-7.Q8.a"
test -f "$Q8/lib/libMagickWand-7.Q8.a"

INC="$Q8/include/ImageMagick-7"
mkdir -p "$INC/MagickCore" "$INC/coders"
cp "$IM_SRC"/MagickCore/*-private.h "$INC/MagickCore/"
cp "$IM_SRC"/coders/*-private.h "$INC/coders/"

echo "== magick-native: stage Magick.Native dependency prefix"
rm -rf "$DEPS"
mkdir -p "$DEPS/lib" "$DEPS/include"
cp "$PREFIX"/lib/*.a "$DEPS/lib/"
# JpegOptimizer includes libjpeg headers from the dependencies prefix.
for h in jpeglib.h jerror.h jmorecfg.h jconfig.h; do
  test -f "$PREFIX/include/$h"
  cp "$PREFIX/include/$h" "$DEPS/include/"
done
ls "$DEPS/lib" | tr '\n' ' '
echo

CM="$MN_SRC/src/Magick.Native/CMakeLists.txt"
perl -i -pe "s|/tmp/ImageMagick|$Q8|g; s|/tmp/dependencies|$DEPS|g" "$CM"
perl -i -pe 's/ --bind / /g; s/-s EMBIND_AOT=1 //g; s/-sEMBIND_AOT=1 //g' "$CM"
awk '
  /^set_target_properties\(/ {
    print "foreach(v LIBAOM LIBBZIP2 LIBCAIRO LIBEXR LIBFONTCONFIG LIBFRIBIDI LIBGLIB LIBHARFBUZZ LIBHEIF LIBJPEGXL LIBLQR LIBLZMA LIBOPENH264 LIBOPENJPH LIBPANGO LIBRAQM LIBRAW LIBRSVG LIBZIP LIBINTL LIBICONV)"
    print "  unset(${v})"
    print "endforeach()"
  }
  { print }
' "$CM" > "$CM.slicc"
mv "$CM.slicc" "$CM"

Q8BUILD="$MN_SRC/src/Magick.Native/Q8"
if [[ ! -f "$Q8BUILD/magick.wasm" || -n "${FORCE:-}" ]]; then
  echo "== magick-native: emcmake Magick.Native Q8 WASM"
  rm -rf "$Q8BUILD"
  mkdir -p "$Q8BUILD"
  (
    cd "$Q8BUILD"
    CFLAGS="-O3 -Wall -DNDEBUG -m32" CXXFLAGS="-O3 -Wall -DNDEBUG -m32" \
      emcmake cmake -G "Unix Makefiles" \
        -DDEPTH=8 -DHDRI_ENABLE=0 -DOPENMP=0 -DQUANTUM_NAME=Q8 \
        -DLIBRARY_NAME=magick -DPLATFORM=WASM -DARCHITECTURE=x86 \
        -DCMAKE_BUILD_TYPE=Release ..
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
  )
fi
test -f "$Q8BUILD/magick.wasm"
test -f "$Q8BUILD/magick.js"

PKG="$HOMESCOOP_PKG/package"
mkdir -p "$PKG/x86" "$PKG/etc"
cp "$Q8BUILD/magick.js" "$PKG/magick.js"
cp "$Q8BUILD/magick.wasm" "$PKG/magick.wasm"
cp "$Q8BUILD/magick.js" "$PKG/x86/magick.js"
cp "$Q8BUILD/magick.wasm" "$PKG/x86/magick.wasm"
if [[ -d "$Q8/etc/ImageMagick-7" ]]; then
  mkdir -p "$PKG/etc/ImageMagick-7"
  find "$Q8/etc/ImageMagick-7" -maxdepth 1 -name '*.xml' -exec cp {} "$PKG/etc/ImageMagick-7/" \;
fi
homescoop_stage_license "$MN_SRC"/License.txt "$MN_SRC"/LICENSE "$MN_SRC"/LICENSE.md
echo "== magick-native: staged magick.js/wasm Q8 → $PKG"
