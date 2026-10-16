#!/usr/bin/env bash
# The relink kits of wasm-imagemagick and wasm-imagemagick-heif (homescoop#593):
# both ImageMagick builds, each writing its kit into this package.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe imagemagick-relink

PKGDIR="$HOMESCOOP_PKG/package"
VERSION_PKG="$(node -p 'require(process.argv[1]).version' "$PKGDIR/package.json")"
for r in imagemagick imagemagick-heif; do
  v="$(node -p 'require(process.argv[1]).version' "$HOMESCOOP_ROOT/packages/$r/package/package.json")"
  if [[ "$v" != "$VERSION_PKG" ]]; then
    echo "homescoop: packages/$r is $v, wasm-imagemagick-relink $VERSION_PKG; bump them together" >&2
    exit 1
  fi
done

rm -rf "$PKGDIR/share"
for r in imagemagick imagemagick-heif; do
  echo "== imagemagick-relink: $r build, kit → share/$r/relink"
  HOMESCOOP_RELINK_KIT="$PKGDIR/share/$r/relink" bash "$HOMESCOOP_ROOT/packages/$r/build.sh"
  test -f "$PKGDIR/share/$r/relink/kit.json"
done

cp "$HOMESCOOP_ROOT/packages/imagemagick/package/LICENSE" "$PKGDIR/LICENSE"
cat >"$PKGDIR/THIRD-PARTY-NOTICES.md" <<NOTICES
# Third-party notices

The archives in this package are the object code of the static link of
\`bin/magick.wasm\` in @ai-ecoverse/wasm-imagemagick and
@ai-ecoverse/wasm-imagemagick-heif $VERSION_PKG, so that either can be relinked
against modified libraries (README.md, Relinking). Each kit carries the
notices of its build:

- share/imagemagick/relink/THIRD-PARTY-NOTICES.md (GNU libiconv, LGPL-2.1-or-later, and the other delegates);
- share/imagemagick-heif/relink/THIRD-PARTY-NOTICES.md (also libheif and libde265, LGPL-3.0-or-later, and dav1d).

\`LICENSE\` is ImageMagick's.
NOTICES
echo "== imagemagick-relink: staged → $PKGDIR ($VERSION_PKG)"
