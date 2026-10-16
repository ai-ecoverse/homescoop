#!/usr/bin/env bash
# Info-ZIP zip 3.0 + unzip 6.0.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe zip
homescoop_load_recipe zip --source unzip

ZIP_TB="$WORK/zip30.tar.gz"
UNZ_TB="$WORK/unzip60.tar.gz"
ZIP_SRC="$WORK/zip30"
UNZ_SRC="$WORK/unzip60"
OUT="$WORK/zip-cli"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$ZIP_TB"
homescoop_fetch "$UNZIP_URL" "$UNZIP_SHA" "$UNZ_TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$ZIP_SRC" "$UNZ_SRC" "$OUT"; fi
homescoop_extract "$ZIP_TB" "$ZIP_SRC"
homescoop_extract "$UNZ_TB" "$UNZ_SRC"

# Two source trees, so not homescoop_apply_patches: zip-*.patch go into zip's,
# unzip-*.patch into unzip's, in filename order, once each.
apply_patches() {
  local src="$1" prefix="$2" p marker
  shopt -s nullglob
  for p in "$HOMESCOOP_PKG"/"$prefix"-*.patch; do
    marker="$src/.homescoop-patched-$(basename "$p")"
    [[ -f "$marker" ]] && continue
    echo "== patch $(basename "$p")"
    patch -d "$src" -p1 <"$p"
    touch "$marker"
  done
  shopt -u nullglob
}
apply_patches "$ZIP_SRC" zip
apply_patches "$UNZ_SRC" unzip

# zip -v and unzip -v print __DATE__: pin it (clang reads SOURCE_DATE_EPOCH),
# so a rebuild on another day has the same bytes (homescoop#441).
SOURCE_DATE_EPOCH="$(node "$ROOT/scripts/read-recipe.mjs" zip --field source.epoch)"
export SOURCE_DATE_EPOCH

SLICC_A="$WORK/libslicc-cli.a"
homescoop_slicc_archive "$SLICC_A" cli

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=524288 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
CLI_LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports)"
mkdir -p "$OUT"

# Info-ZIP unix makefiles: force CC/CFLAGS and append our link line after the
# objects: zip's makefile calls it LFLAGS2, unzip's LF2 (SL2/FL2 default to it).
build_infozip() {
  local src="$1" target="$2" mf="$3" extra="${4:-}"
  echo "== zip: emmake $target ($src)"
  (
    cd "$src"
    # shellcheck disable=SC2086
    emmake make -f "$mf" "$target" \
      CC=emcc BIND=emcc AS=emcc \
      CFLAGS="-O2 -I. -DUNIX -DNO_LCHMOD -DNO_LCHOWN${extra:+ $extra}" \
      LFLAGS1= LFLAGS2="$SLICC_A $CLI_LDFLAGS" LF2="$SLICC_A $CLI_LDFLAGS" \
      LDFLAGS="$SLICC_A $CLI_LDFLAGS" \
      -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
  )
}

# UNICODE_SUPPORT (and unzip's UNICODE_WCHAR, UTF8_MAYBE_NATIVE, _MBCS,
# NO_WORKING_ISPRINT) are what unix/configure and Debian give both on Linux
# (homescoop#431): zip marks a non-ASCII name UTF-8 (general purpose bit 11)
# in a UTF-8 locale, and unzip shows such names instead of "?" and reads
# the Unicode path extra field.
if [[ ! -f "$OUT/zip.wasm" || -n "${FORCE:-}" ]]; then
  build_infozip "$ZIP_SRC" zip unix/Makefile "-DLARGE_FILE_SUPPORT -DZIP64_SUPPORT -DUIDGID_NOT_16BIT -DHAVE_DIRENT_H -DHAVE_TERMIOS_H -DUNICODE_SUPPORT"
  # zip makefile leaves binary as ./zip (or zip.exe)
  if [[ -f "$ZIP_SRC/zip.js" ]]; then mv "$ZIP_SRC/zip.js" "$ZIP_SRC/zip"; fi
  cp "$ZIP_SRC/zip" "$ZIP_SRC/zip.wasm" "$OUT/" 2>/dev/null || {
    # Some builds name the glue without extension and wasm alongside
    cp "$ZIP_SRC/zip" "$OUT/zip"
    cp "$ZIP_SRC/zip.wasm" "$OUT/zip.wasm"
  }
fi

if [[ ! -f "$OUT/unzip.wasm" || -n "${FORCE:-}" ]]; then
  build_infozip "$UNZ_SRC" unzip unix/Makefile "-include unistd.h -include utime.h -DGOT_UTIMBUF -DLARGE_FILE_SUPPORT -DUSE_UNSHRINK -DUNICODE_SUPPORT -DUNICODE_WCHAR -DUTF8_MAYBE_NATIVE -D_MBCS -DNO_WORKING_ISPRINT"
  if [[ -f "$UNZ_SRC/unzip.js" ]]; then mv "$UNZ_SRC/unzip.js" "$UNZ_SRC/unzip"; fi
  cp "$UNZ_SRC/unzip" "$UNZ_SRC/unzip.wasm" "$OUT/"
fi

homescoop_stage_cli "$OUT" zip
homescoop_stage_cli "$OUT" unzip
# zip's licence (2007-Mar-4) and unzip's (2009-Jan-02): the package ships both.
homescoop_stage_licenses "$ZIP_SRC"/LICENSE "$UNZ_SRC"/LICENSE
echo "== zip: staged → $HOMESCOOP_PKG/package"

