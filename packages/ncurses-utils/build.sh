#!/usr/bin/env bash
# ncurses clear / tput / tset (+ reset) and a compiled terminfo database.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe ncurses-utils

NC_TB="$WORK/ncurses-$VERSION.tar.gz"
# Own subdirectory: less and bash extract the same tarball to $WORK/ncurses-6.5.
NC_DIR="$WORK/ncurses-utils"
NC_SRC="$NC_DIR/ncurses-$VERSION"
HOST_PREFIX="$NC_DIR/host"
WASM_PREFIX="$NC_DIR/wasm-prefix"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
# Shipped terminfo entries: what slicc terminals report (xterm-256color) plus
# the usual suspects a script may set. The first four are also fallbacks.
FALLBACKS="xterm-256color,xterm,vt100,dumb"
TERMS="$FALLBACKS,xterm-color,xterm-direct,vt102,vt220,ansi,linux,screen,screen-256color,tmux,tmux-256color"
# One database layout (letter directories) whatever the build filesystem.
export cf_cv_mixedcase=yes

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$NC_TB"
if [[ -n "${FORCE:-}" ]]; then
  rm -rf "$NC_SRC" "$HOST_PREFIX" "$WASM_PREFIX"
fi

# --- host tic/infocmp from the same ncurses (host tic may be too old) ---
if [[ ! -x "$HOST_PREFIX/bin/tic" ]]; then
  echo "== ncurses-utils: native ncurses (tic/infocmp)"
  HOST_SRC="$NC_DIR/host-src"
  rm -rf "$HOST_SRC"
  mkdir -p "$HOST_SRC"
  tar xzf "$NC_TB" -C "$HOST_SRC"
  (
    cd "$HOST_SRC/ncurses-$VERSION"
    ./configure --prefix="$HOST_PREFIX" \
      --without-shared --without-cxx --without-ada --without-tests \
      --without-manpages --enable-widec
    make -j"$JOBS"
    make install.progs
  )
fi
test -x "$HOST_PREFIX/bin/tic"

homescoop_extract "$NC_TB" "$NC_SRC"
# BSD sed never matches GNU \<short\> in MKfallback.sh (same fix as less/bash).
MKF="$NC_SRC/ncurses/tinfo/MKfallback.sh"
if [[ -f "$MKF" ]] && grep -q 's/\\<short\\>/NCURSES_INT2/g' "$MKF"; then
  perl -i -pe 's#s/\\<short\\>/NCURSES_INT2/g#s/^static short /static NCURSES_INT2 /#' "$MKF"
  grep -q 'static NCURSES_INT2' "$MKF"
fi

SLICC_A="$WORK/libslicc-ncurses-utils.a"
homescoop_slicc_archive "$SLICC_A" gaps
export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=262144 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
CLI_LDFLAGS="$(homescoop_slicc_keep_exports) $(homescoop_em_cli_ldflags) -Wl,--whole-archive $SLICC_A -Wl,--no-whole-archive"

PROGS=(clear tput tset)
if [[ ! -f "$NC_SRC/progs/clear.wasm" || -n "${FORCE:-}" ]]; then
  echo "== ncurses-utils: emconfigure ncurses (widec, database + fallbacks)"
  (
    cd "$NC_SRC"
    if [[ -f Makefile ]]; then make distclean >/dev/null 2>&1 || true; fi
    BUILD_TRIPLE="$(cc -dumpmachine 2>/dev/null || echo x86_64-pc-linux-gnu)"
    emconfigure ./configure \
      --with-tic-path="$HOST_PREFIX/bin/tic" \
      --with-infocmp-path="$HOST_PREFIX/bin/infocmp" \
      --host=wasm32-unknown-emscripten --build="$BUILD_TRIPLE" \
      --prefix="$WASM_PREFIX" --with-build-cc=cc \
      --without-shared --without-cxx --without-cxx-binding \
      --without-ada --without-tests --without-manpages \
      --without-debug --enable-widec --disable-stripping \
      --disable-hashed-db --with-default-terminfo-dir=/usr/share/terminfo \
      --with-fallbacks="$FALLBACKS"
    homescoop_fix_darwin_ar Makefile
    find . -name Makefile -print0 | while IFS= read -r -d '' mf; do
      homescoop_fix_darwin_ar "$mf"
    done
    emmake make -j"$JOBS" libs
    # Link the three programs against libslicc; keep configure's own libs.
    emmake make -C progs -j"$JOBS" "${PROGS[@]}" \
      LDFLAGS="-L../lib $CLI_LDFLAGS"
  )
fi

for p in "${PROGS[@]}"; do
  if [[ -f "$NC_SRC/progs/$p.js" ]]; then mv "$NC_SRC/progs/$p.js" "$NC_SRC/progs/$p"; fi
  test -f "$NC_SRC/progs/$p.wasm"
  homescoop_stage_cli "$NC_SRC/progs" "$p"
done

# --- compiled terminfo database (-x keeps extended caps such as E3) ---
DB="$HOMESCOOP_PKG/package/share/terminfo"
rm -rf "$DB"
mkdir -p "$DB"
TERMINFO="$DB" "$HOST_PREFIX/bin/tic" -x -e "$TERMS" "$NC_SRC/misc/terminfo.src"
# tic writes aliases (nxterm/xterm-color, vt100-am, vt200/vt220) as hard
# links, and the npm registry rejects links in a tarball (E415): make every
# entry its own regular file.
find "$DB" -type l -print0 | while IFS= read -r -d '' f; do
  cp -L "$f" "$f.tmp" && rm "$f" && mv "$f.tmp" "$f"
done
find "$DB" -type f -links +1 -print0 | while IFS= read -r -d '' f; do
  cp "$f" "$f.tmp" && mv "$f.tmp" "$f"
done
for t in ${TERMS//,/ }; do
  test -f "$DB/${t:0:1}/$t" || { echo "ncurses-utils: missing terminfo $t" >&2; exit 1; }
done
homescoop_assert_no_package_links "$HOMESCOOP_PKG/package"

homescoop_stage_license "$NC_SRC"/COPYING
echo "== ncurses-utils: staged → $HOMESCOOP_PKG/package ($VERSION)"
