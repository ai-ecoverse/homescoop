#!/usr/bin/env bash
# Graphviz dot_static (layouts and core renderers linked in) for the slicc wasm realm.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe graphviz

TB="$WORK/graphviz-$VER.tar.xz"
SRC="$WORK/graphviz-$VER"

homescoop_fetch "$URL" "$SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC"; fi
homescoop_extract "$TB" "$SRC"
homescoop_apply_patches "$SRC"

SLICC_A="$WORK/libslicc-cli.a"
homescoop_slicc_archive "$SLICC_A" cli

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=2097152 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain -sINITIAL_MEMORY=${WASM_INITIAL_MEMORY:?recipe.yaml wasm.initial-memory}"
# C++ throws (lib/vpsc, lib/neatogen, dot_builtins.cpp) as wasm exceptions, as qpdf's: the
# kernel's Emscripten runtime has no JS __cxa_throw.
CLI_LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports) -fwasm-exceptions $SLICC_A"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
DOT="$SRC/cmd/dot"

if [[ ! -f "$DOT/dot_static.wasm" || -n "${FORCE:-}" ]]; then
  echo "== graphviz: emconfigure (static, no ltdl, no expat/zlib/cairo)"
  (
    cd "$SRC"
    if [[ -f Makefile ]]; then make distclean >/dev/null 2>&1 || true; fi
    # No <sys/mman.h>: the kernel's runtime has no _munmap_js, and graphviz maps files only to
    # read the images of labels (plugin/core/gvloadimage_core.c), which it then reads instead.
    ac_cv_header_sys_mman_h=no CFLAGS="-O2 -fwasm-exceptions" CXXFLAGS="-O2 -fwasm-exceptions" \
    emconfigure ./configure \
      --build=x86_64-pc-linux-gnu --host=wasm32-unknown-emscripten \
      --enable-static --disable-shared --disable-ltdl \
      --without-expat --without-zlib --without-libgd --without-gdk --without-gdk-pixbuf \
      --without-gtk --without-gtkgl --without-gts --without-pangocairo --without-poppler \
      --without-rsvg --without-webp --without-x --without-qt --without-glut --without-ann \
      --without-devil --without-ghostscript --without-lasi --without-freetype2 \
      --without-fontconfig --without-gvedit --without-smyrna --disable-swig \
      --disable-man-pdfs --disable-tcl --disable-guile --disable-lua --disable-perl \
      --disable-php --disable-python --disable-r --disable-ruby --disable-go \
      --disable-java --disable-javascript --disable-ocaml --disable-sharp
    homescoop_fix_darwin_ar Makefile
    while IFS= read -r mf; do homescoop_fix_darwin_ar "$mf"; done < <(find lib plugin cmd/dot -name Makefile)
    emmake make -j"$JOBS" -C lib
    for p in core dot_layout neato_layout kitty vt; do emmake make -j"$JOBS" -C "plugin/$p"; done
    # shellcheck disable=SC2086
    emmake make -C cmd/dot dot_static LDFLAGS="$CLI_LDFLAGS"
  )
fi
if [[ -f "$DOT/dot_static.js" ]]; then mv "$DOT/dot_static.js" "$DOT/dot_static"; fi
test -f "$DOT/dot_static.wasm"
OUT="$WORK/graphviz-cli"
rm -rf "$OUT" && mkdir -p "$OUT"
cp "$DOT/dot_static.wasm" "$OUT/dot.wasm"
sed 's/dot_static\.wasm/dot.wasm/g' "$DOT/dot_static" > "$OUT/dot"
homescoop_stage_cli "$OUT" dot
homescoop_stage_license "$SRC"/COPYING "$SRC"/LICENSE
homescoop_notices_begin "The wasm module in bin/ statically links the following."
homescoop_notice_emscripten
echo "== graphviz: staged → $HOMESCOOP_PKG/package ($VER)"
