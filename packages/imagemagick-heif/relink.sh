#!/usr/bin/env bash
# relink.sh <out-dir> <dir>: link magick (magick + magick.wasm) again from this kit.
# <dir> holds libheif.a, libde265.a and libdav1d.a (wasm-libheif's lib/, or your
# own build). Any other static library in <dir> with the name of one of the
# kit's (libiconv.a, say, or one ldflags.txt names) is linked instead of the
# kit's copy, as in wasm-imagemagick's relink.sh. Needs Emscripten 4.0.23.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
USAGE="usage: relink.sh <out-dir> <dir with libheif.a libde265.a libdav1d.a, and any replacement static libraries>"
OUT="${1:?$USAGE}"
OVR="$(cd "${2:?$USAGE}" && pwd)"
for a in libheif.a libde265.a libdav1d.a; do
  test -f "$OVR/$a" || { echo "relink.sh: $OVR/$a missing" >&2; exit 1; }
done
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
cd "$HERE"
lib() {
  if [[ -f "$OVR/$1" ]]; then
    case "$1" in libheif.a | libde265.a | libdav1d.a) ;; *) echo "relink.sh: $1 from $OVR" >&2 ;; esac
    printf '%s' "$OVR/$1"
  else
    printf '%s' "$HERE/$1"
  fi
}
LIBS=()
for a in libMagickCore-7.Q16HDRI.a libMagickWand-7.Q16HDRI.a libMagickCore-7.Q16HDRI.a liblcms2.a libtiff.a libjpeg.a libfreetype.a libpng16.a libheif.a libde265.a libdav1d.a libz.a libwebpmux.a libwebpdemux.a libwebp.a libsharpyuv.a libopenjp2.a libxml2.a libiconv.a; do
  LIBS+=("$(lib "$a")")
done
FLAGS=()
read -r -a words <ldflags.txt
for w in "${words[@]}"; do
  if [[ "$w" == *.a && "$w" != */* ]]; then FLAGS+=("$(lib "$w")"); else FLAGS+=("$w"); fi
done
em++ -g -O2 -fexceptions -o "$OUT/magick.js" \
  -Wl,--whole-archive "$(lib magick.a)" -Wl,--no-whole-archive \
  "${LIBS[@]}" -lm "$(lib libslicc-cli.a)" "${FLAGS[@]}"
mv "$OUT/magick.js" "$OUT/magick"
echo "relinked: $OUT/magick(.wasm)"
