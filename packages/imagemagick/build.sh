#!/usr/bin/env bash
# ImageMagick 7.1.2-32 utilities/magick — port of slicc-emscripten harness/ladder.sh rung_magick.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
HOMESCOOP_PKG="$ROOT/packages/imagemagick"

VER=7.1.2-32
URL="https://github.com/ImageMagick/ImageMagick/archive/refs/tags/${VER}.tar.gz"
SHA=34d9cc3acddc3e3c429d23af60eda5ceaac477a8b296ddb9469f773f44a80a5f
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
  libwebpmux libwebpdemux libopenjp2 freetype2 libxml-2.0 | tr '\n' ' '
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
        --without-raw --without-rsvg --without-uhdr --without-wmf --without-zip \
        --without-zstd \
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
echo "== imagemagick: staged → $HOMESCOOP_PKG/package ($VER) + etc/ImageMagick-7"
