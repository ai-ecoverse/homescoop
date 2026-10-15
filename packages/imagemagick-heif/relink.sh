#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:?usage: relink.sh <out-dir> <dir with libheif.a libde265.a libdav1d.a>}"
HEIF="$(cd "${2:?usage: relink.sh <out-dir> <dir with libheif.a libde265.a libdav1d.a>}" && pwd)"
for a in libheif.a libde265.a libdav1d.a; do
  test -f "$HEIF/$a" || { echo "relink.sh: $HEIF/$a missing" >&2; exit 1; }
done
mkdir -p "$OUT"
cd "$HERE"
read -r -a FLAGS <ldflags.txt
em++ -g1 -O2 -fexceptions -o "$OUT/magick.js" \
  -Wl,--whole-archive magick.a -Wl,--no-whole-archive \
  libMagickCore-7.Q16HDRI.a libMagickWand-7.Q16HDRI.a libMagickCore-7.Q16HDRI.a \
  liblcms2.a libtiff.a libjpeg.a libfreetype.a libpng16.a \
  "$HEIF/libheif.a" "$HEIF/libde265.a" "$HEIF/libdav1d.a" \
  libz.a libwebpmux.a libwebpdemux.a libwebp.a libsharpyuv.a libopenjp2.a \
  libxml2.a libiconv.a -lm libslicc-cli.a "${FLAGS[@]}"
mv "$OUT/magick.js" "$OUT/magick"
echo "relinked: $OUT/magick(.wasm)"
