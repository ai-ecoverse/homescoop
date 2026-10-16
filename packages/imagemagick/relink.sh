#!/usr/bin/env bash
# relink.sh <out-dir> [dir]: link magick (magick + magick.wasm) again from this kit.
# A static library in <dir> with the name of one of the kit's (libiconv.a, say)
# is linked instead of the kit's copy. Needs Emscripten 4.0.23 (em++ on PATH).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:?usage: relink.sh <out-dir> [dir with replacement static libraries, e.g. libiconv.a]}"
OVR=""
if [[ -n "${2:-}" ]]; then OVR="$(cd "$2" && pwd)"; fi
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
cd "$HERE"
lib() {
  if [[ -n "$OVR" && -f "$OVR/$1" ]]; then
    echo "relink.sh: $1 from $OVR" >&2
    printf '%s' "$OVR/$1"
  else
    printf '%s' "$HERE/$1"
  fi
}
LIBS=()
for a in liblcms2.a libtiff.a libjpeg.a libfreetype.a libpng16.a libz.a libwebpmux.a libwebpdemux.a libwebp.a libsharpyuv.a libopenjp2.a libxml2.a libiconv.a; do
  LIBS+=("$(lib "$a")")
done
read -r -a FLAGS <ldflags.txt
em++ -g -O2 -o "$OUT/magick.js" \
  -Wl,--whole-archive magick.a -Wl,--no-whole-archive \
  libMagickCore-7.Q16HDRI.a libMagickWand-7.Q16HDRI.a libMagickCore-7.Q16HDRI.a \
  "${LIBS[@]}" -lm libslicc-cli.a "${FLAGS[@]}"
mv "$OUT/magick.js" "$OUT/magick"
echo "relinked: $OUT/magick(.wasm)"
