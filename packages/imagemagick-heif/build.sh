#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe imagemagick-heif

TB="$WORK/ImageMagick-${VER}.tar.gz"
mkdir -p "$WORK/imagemagick-heif"
SRC="$WORK/imagemagick-heif/ImageMagick-${VER}"

homescoop_fetch "$URL" "$SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC"; fi
homescoop_extract "$TB" "$SRC"
test -f "$SRC/configure"
# The patches are wasm-imagemagick's (packages/imagemagick/*.patch, recipe inputs).
HOMESCOOP_PKG="$HOMESCOOP_ROOT/packages/imagemagick" homescoop_apply_patches "$SRC"

SLICC_A="$WORK/libslicc-cli.a"
homescoop_slicc_archive "$SLICC_A" cli

export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig"
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"
unset PKG_CONFIG_SYSROOT_DIR || true
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
  libwebpmux libwebpdemux libopenjp2 freetype2 libxml-2.0 libheif | tr '\n' ' '
echo
"$PKG_CONFIG" --atleast-version=0.4.1 libwebp
"$PKG_CONFIG" --atleast-version=2.8.0 freetype2
"$PKG_CONFIG" --atleast-version=2.0.0 libxml-2.0
"$PKG_CONFIG" --atleast-version=1.23.6 libheif

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1048576 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
CLI_LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports)"

# The configure in $SRC must be this package's: webp, freetype, xml and heic in
# (homescoop#350). A tree configured otherwise is configured again.
im_config_ok() {
  local h="$SRC/config/config.h" d
  [[ -f "$h" ]] || return 1
  for d in WEBP FREETYPE XML HEIC; do
    grep -q "^#define ${d}_DELEGATE 1" "$h" || return 1
  done
}
# What the tree in $SRC was built with: configure arguments, link flags, patches.
# A tree built with others (an older build.sh, other delegates or flags) is
# configured again (homescoop#350).
CONFIGURE_ARGS=(
  --host=wasm32-unknown-emscripten
  --disable-shared --enable-static --disable-openmp --without-threads
  --without-modules --disable-docs --without-perl --without-magick-plus-plus
  --without-x --without-bzlib --without-djvu --without-dps --without-fftw
  --without-flif --without-fpx --without-fontconfig --without-gslib
  --without-gvc --with-heic --without-jbig --without-jxl --without-lqr
  --without-lzma --without-openexr --without-pango --without-raqm
  --without-raw --without-rsvg --without-uhdr --without-wmf --with-xml
  --without-zip --without-zstd --with-webp --with-freetype
  CFLAGS="-g1 -O2" CXXFLAGS="-g2 -O2"
  LDFLAGS="-L$PREFIX/lib -fexceptions"
)
MAKE_LDFLAGS="-L$PREFIX/lib -fexceptions $SLICC_A $CLI_LDFLAGS"
STAMP="$SRC/.homescoop-build"
want_stamp() { { printf '%s\n' "${CONFIGURE_ARGS[@]}" "$MAKE_LDFLAGS"; cat "$HOMESCOOP_ROOT"/packages/imagemagick/*.patch; } | shasum -a 256 | cut -d' ' -f1; }
REBUILD="${FORCE:-}"
if [[ -z "$REBUILD" && ( -f "$SRC/utilities/magick" || -f "$SRC/utilities/magick.js" ) ]]; then
  if ! im_config_ok; then
    echo "== imagemagick-heif: $SRC was configured with other delegates (homescoop#350), configuring again"
    REBUILD=1
  elif [[ "$(cat "$STAMP" 2>/dev/null)" != "$(want_stamp)" ]]; then
    echo "== imagemagick-heif: $SRC was built with other configure or link flags, configuring again"
    REBUILD=1
  fi
fi

# utilities/magick is linked by the C++ driver (utilities/Makefile.am's
# dummy.cxx), with CXXFLAGS: -g2 there keeps the name section (-g1 stripped
# it, homescoop#396) and drops the DWARF line tables (homescoop#593), as in
# wasm-imagemagick.
if [[ ! -f "$SRC/utilities/magick" && ! -f "$SRC/utilities/magick.js" || -n "$REBUILD" ]]; then
  echo "== imagemagick: emconfigure"
  (
    cd "$SRC"
    rm -f "$STAMP"
    if [[ -f Makefile ]]; then
      make distclean >/dev/null 2>&1 || true
    fi
    PKG_CONFIG="$PKG_CONFIG" EM_PKG_CONFIG_PATH="$EM_PKG_CONFIG_PATH" \
      PKG_CONFIG_LIBDIR="$PKG_CONFIG_LIBDIR" \
      emconfigure ./configure "${CONFIGURE_ARGS[@]}"
    for d in WEBP FREETYPE XML HEIC; do
      grep -q "^#define ${d}_DELEGATE 1" config/config.h || { echo "homescoop: configure left out the ${d} delegate" >&2; exit 1; }
    done
    homescoop_fix_darwin_ar Makefile
    find . -name Makefile -print0 | while IFS= read -r -d '' mf; do
      homescoop_fix_darwin_ar "$mf"
    done
    echo "== imagemagick: emmake utilities/magick"
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
      utilities/magick \
      LDFLAGS="$MAKE_LDFLAGS"
    want_stamp >"$STAMP"
  )
fi

MAGICK_BIN=""
for c in "$SRC/utilities/magick" "$SRC/utilities/magick.js"; do
  if [[ -f "$c" ]]; then MAGICK_BIN="$c"; break; fi
done
test -n "$MAGICK_BIN"
UTIL="$SRC/utilities"
if [[ -f "$UTIL/magick.js" && ! -f "$UTIL/magick" ]]; then
  mv "$UTIL/magick.js" "$UTIL/magick"
fi
test -f "$UTIL/magick.wasm"
# Outside the skip above: whatever built $SRC, this package has the HEIC delegate.
im_config_ok || { echo "homescoop: $SRC/config/config.h is not wasm-imagemagick-heif's configure (webp, freetype, xml, heic)" >&2; exit 1; }
if ! LC_ALL=C grep -aq 'heif_' "$UTIL/magick.wasm"; then
  echo "homescoop: $UTIL/magick.wasm does not link libheif (homescoop#350)" >&2
  exit 1
fi
homescoop_stage_cli "$UTIL" magick

CFG_DEST="$HOMESCOOP_PKG/package/etc/ImageMagick-7"
CFG_OPEN="$HOMESCOOP_PKG/package/etc/ImageMagick-7-open"
rm -rf "$CFG_DEST" "$CFG_OPEN"
mkdir -p "$CFG_DEST" "$CFG_OPEN"
find "$SRC/config" -maxdepth 1 -name '*.xml' -exec cp {} "$CFG_DEST/" \;
find "$SRC/config" -maxdepth 1 -name '*.xml' -exec cp {} "$CFG_OPEN/" \;
test -f "$CFG_DEST/colors.xml"
cp "$HOMESCOOP_ROOT/packages/imagemagick/policy-tab.xml" "$CFG_DEST/policy.xml"
cp "$SRC/config/policy-open.xml" "$CFG_OPEN/policy.xml"
for d in "$CFG_DEST" "$CFG_OPEN"; do
  perl -0 -i -pe 's{^\s*<delegate decode="svg" command="&apos;rsvg-convert&apos;[^\n]*\n}{}m; s{^\s*<!-- Change export-filename to export-png for inkscape[^\n]*\n}{}m; s{^\s*<delegate decode="svg:decode"[^\n]*inkscape[^\n]*\n}{}m' "$d/delegates.xml"
  if grep -q 'inkscape\|rsvg-convert' "$d/delegates.xml"; then echo "homescoop: $d/delegates.xml still names inkscape/rsvg-convert" >&2; exit 1; fi
done
grep -q 'name="disk" value="0"' "$CFG_DEST/policy.xml"

homescoop_stage_license "$SRC"/LICENSE "$SRC"/COPYING "$SRC"/Copyright.txt
homescoop_notices_begin "magick.wasm statically links the following delegate libraries, including libheif and libde265 (LGPL-3.0-or-later; libde265 is an HEVC decoder, and HEVC is patent-encumbered) from @ai-ecoverse/wasm-libheif. No MPEG-family video codec. The relink kit, magick's objects and every other library it links, so that it can be relinked against a modified libheif, libde265 or GNU libiconv, is the package @ai-ecoverse/wasm-imagemagick-relink of the same version on the same registry (share/imagemagick-heif/relink; README.md, Relinking)."
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
homescoop_notice "libxml2 2.15.4 (@ai-ecoverse/wasm-libxml2)" \
  https://raw.githubusercontent.com/GNOME/libxml2/v2.15.4/Copyright 5d4873884a890122a4b9b20ad56ac6f7da1d796a5bfcf04a427970ac96217626
ICONV_TB="$WORK/libiconv-1.18.tar.gz"
homescoop_fetch https://mirrors.kernel.org/gnu/libiconv/libiconv-1.18.tar.gz 3b08f5f4f9b4eb82f151a7040bfd6fe6c6fb922efe4b1659c66ea933276965e8 "$ICONV_TB"
tar xzf "$ICONV_TB" -C "$WORK" libiconv-1.18/COPYING.LIB
homescoop_notice "GNU libiconv 1.18 (@ai-ecoverse/wasm-libiconv, for libxml2), LGPL-2.1-or-later; source and build: homescoop packages/libiconv (recipe.yaml, build.sh), https://github.com/ai-ecoverse/homescoop/tree/main/packages/libiconv" "$WORK/libiconv-1.18/COPYING.LIB" -
homescoop_notice "libheif 1.23.6 (@ai-ecoverse/wasm-libheif); source and build: homescoop packages/libheif (recipe.yaml, build.sh, patches), https://github.com/ai-ecoverse/homescoop/tree/main/packages/libheif" \
  https://raw.githubusercontent.com/strukturag/libheif/v1.23.6/COPYING fa81ce652315b013359d6e8e4744335f31a50c7c192907176d3632f78a3b4596
homescoop_notice "libde265 1.1.3 (@ai-ecoverse/wasm-libheif); source and build: homescoop packages/libheif (recipe.yaml, build.sh, patches), https://github.com/ai-ecoverse/homescoop/tree/main/packages/libheif" \
  https://raw.githubusercontent.com/strukturag/libde265/v1.1.3/COPYING 02cc1585a20677992e0ba578fa692635dc193735f2691dc81de924b51c4e8020
DAV1D_TB="$WORK/dav1d-1.5.4.tar.xz"
homescoop_fetch https://downloads.videolan.org/pub/videolan/dav1d/1.5.4/dav1d-1.5.4.tar.xz 686616b7c69eb88d44459391ab25cac13b6647a3b288835c5784e71c1514a5c5 "$DAV1D_TB"
tar xJf "$DAV1D_TB" -C "$WORK" dav1d-1.5.4/COPYING
homescoop_notice "dav1d 1.5.4 (@ai-ecoverse/wasm-libheif); source and build: homescoop packages/libheif (recipe.yaml, build.sh, patches), https://github.com/ai-ecoverse/homescoop/tree/main/packages/libheif" "$WORK/dav1d-1.5.4/COPYING" -
homescoop_notice_emscripten

# kit_ldflags <kit> <flags>: write <kit>/ldflags.txt with every file the link
# flags name by absolute path (each --js-library into js/, archives such as the
# slicc credential library next to the others) copied into the kit and named
# relative to it, so relink.sh never reaches into the build host's tree
# (homescoop#398).
kit_ldflags() {
  local kit="$1" prev="" t
  local -a words=() out=()
  read -r -a words <<<"$2"
  mkdir -p "$kit/js"
  for t in "${words[@]}"; do
    if [[ "$prev" == "--js-library" ]]; then
      cp "$t" "$kit/js/"
      out+=("js/$(basename "$t")")
    elif [[ "$t" == /* ]]; then
      test -f "$t" || { echo "homescoop: link flag $t is not a file" >&2; exit 1; }
      cp "$t" "$kit/$(basename "$t")"
      out+=("$(basename "$t")")
    else
      out+=("$t")
    fi
    prev="$t"
  done
  printf '%s\n' "${out[*]}" >"$kit/ldflags.txt"
  if grep -Eq '(^| )/' "$kit/ldflags.txt"; then echo "homescoop: $kit/ldflags.txt names an absolute path" >&2; exit 1; fi
}

# The relink kit (homescoop#395, #593) ships in @ai-ecoverse/wasm-imagemagick-relink:
# packages/imagemagick-relink/build.sh runs this build with HOMESCOOP_RELINK_KIT
# set to its share/imagemagick-heif/relink. magick's objects, every static library of
# the link, the slicc archives and --js-library files, relink.sh, this build's
# notices and kit.json (the magick.wasm these objects made: sha256, size).
rm -rf "$HOMESCOOP_PKG/package/share"
if [[ -n "${HOMESCOOP_RELINK_KIT:-}" ]]; then
  RELINK="$HOMESCOOP_RELINK_KIT"
  rm -rf "$RELINK"
  mkdir -p "$RELINK/js"
  MAGICK_OBJS=()
  while IFS= read -r o; do MAGICK_OBJS+=("$o"); done < <(find "$SRC/utilities" -name '*.o' | sort)
  test "${#MAGICK_OBJS[@]}" -gt 0
  emar rcs "$RELINK/magick.a" "${MAGICK_OBJS[@]}"
  cp "$SRC/MagickWand/.libs/libMagickWand-7.Q16HDRI.a" "$SRC/MagickCore/.libs/libMagickCore-7.Q16HDRI.a" "$RELINK/"
  for a in liblcms2.a libtiff.a libjpeg.a libfreetype.a libpng16.a libz.a libwebpmux.a libwebpdemux.a libwebp.a libsharpyuv.a libopenjp2.a libxml2.a libiconv.a; do
    cp "$PREFIX/lib/$a" "$RELINK/$a"
  done
  cp "$SLICC_A" "$RELINK/libslicc-cli.a"
  kit_ldflags "$RELINK" "$CLI_LDFLAGS"
  test -f "$RELINK/js/slicc-writev.js"
  cp "$HOMESCOOP_PKG/relink.sh" "$RELINK/relink.sh"
  cp "$HOMESCOOP_PKG/package/THIRD-PARTY-NOTICES.md" "$RELINK/THIRD-PARTY-NOTICES.md"
  node -e '
    const fs = require("fs"), c = require("crypto");
    const [wasm, pkg, out] = process.argv.slice(1);
    const b = fs.readFileSync(wasm), m = JSON.parse(fs.readFileSync(pkg, "utf8")), mod = new WebAssembly.Module(b);
    const h = (l) => c.createHash("sha256").update(l.join("\n")).digest("hex");
    fs.writeFileSync(out, JSON.stringify({ package: m.name, version: m.version, wasm: "bin/magick.wasm",
      sha256: c.createHash("sha256").update(b).digest("hex"), size: b.length,
      imports: h(WebAssembly.Module.imports(mod).map((i) => `${i.module}.${i.name}:${i.kind}`).sort()),
      exports: h(WebAssembly.Module.exports(mod).map((e) => `${e.name}:${e.kind}`).sort()) }, null, 2) + "\n");
  ' "$HOMESCOOP_PKG/package/bin/magick.wasm" "$HOMESCOOP_PKG/package/package.json" "$RELINK/kit.json"
  echo "== imagemagick-heif: relink kit → $RELINK"
fi
echo "== imagemagick-heif: staged → $HOMESCOOP_PKG/package ($VER) + etc/ImageMagick-7 (tab policy) and etc/ImageMagick-7-open"
