#!/usr/bin/env bash
# less 668 + static widec ncurses 6.5 — port of slicc build-wasm-less.sh.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
HOMESCOOP_PKG="$ROOT/packages/less"

LESS_VER=668
NCURSES_VER=6.5
LESS_URL=https://www.greenwoodsoftware.com/less/less-668.tar.gz
LESS_SHA=2819f55564d86d542abbecafd82ff61e819a3eec967faa36cd3e68f1596a44b8
NCURSES_URL=https://ftp.gnu.org/gnu/ncurses/ncurses-6.5.tar.gz
NCURSES_SHA=136d91bc269a9a5785e5f9e980bc76ab57428f604ce3e5a5a90cebc767971cc6

LESS_TB="$WORK/less-$LESS_VER.tar.gz"
NC_TB="$WORK/ncurses-$NCURSES_VER.tar.gz"
NC_SRC="$WORK/ncurses-$NCURSES_VER"
LESS_SRC="$WORK/less-$LESS_VER"
HOST_PREFIX="$WORK/ncurses-host"
WASM_PREFIX="$WORK/ncurses-wasm-prefix"

homescoop_fetch "$LESS_URL" "$LESS_SHA" "$LESS_TB"
homescoop_fetch "$NCURSES_URL" "$NCURSES_SHA" "$NC_TB"

if [[ -n "${FORCE:-}" ]]; then
  rm -rf "$NC_SRC" "$LESS_SRC" "$HOST_PREFIX" "$WASM_PREFIX"
fi

# --- host tic/infocmp from the same ncurses (host tic may be too old) ---
if [[ ! -x "$HOST_PREFIX/bin/tic" ]]; then
  echo "== less: native ncurses (tic/infocmp)"
  HOST_SRC="$WORK/ncurses-host-src"
  rm -rf "$HOST_SRC"
  mkdir -p "$HOST_SRC"
  tar xzf "$NC_TB" -C "$HOST_SRC"
  (
    cd "$HOST_SRC/ncurses-$NCURSES_VER"
    ./configure --prefix="$HOST_PREFIX" \
      --without-shared --without-cxx --without-ada --without-tests \
      --without-manpages --enable-widec
    make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
    make install.progs
  )
fi
test -x "$HOST_PREFIX/bin/tic"
test -x "$HOST_PREFIX/bin/infocmp"

# --- wasm ncurses with compiled-in fallbacks ---
homescoop_extract "$NC_TB" "$NC_SRC"
# BSD sed never matches GNU \<short\> in MKfallback.sh → short vs int errors.
# Portable rewrite (no-op on already-patched trees / GNU sed hosts that work).
MKF="$NC_SRC/ncurses/tinfo/MKfallback.sh"
if [[ -f "$MKF" ]] && grep -q 's/\\<short\\>/NCURSES_INT2/g' "$MKF"; then
  echo "== less: patch MKfallback.sh for portable sed"
  perl -i -pe 's#s/\\<short\\>/NCURSES_INT2/g#s/^static short /static NCURSES_INT2 /#' "$MKF"
  grep -q 'static NCURSES_INT2' "$MKF"
fi

if [[ ! -f "$WASM_PREFIX/lib/libncursesw.a" || -n "${FORCE:-}" ]]; then
  echo "== less: emconfigure ncurses (widec, fallbacks)"
  (
    cd "$NC_SRC"
    if [[ -f Makefile ]]; then
      make distclean >/dev/null 2>&1 || true
    fi
    BUILD_TRIPLE="$(cc -dumpmachine 2>/dev/null || echo x86_64-pc-linux-gnu)"
    emconfigure ./configure \
      --with-tic-path="$HOST_PREFIX/bin/tic" \
      --with-infocmp-path="$HOST_PREFIX/bin/infocmp" \
      --host=wasm32-unknown-emscripten --build="$BUILD_TRIPLE" \
      --prefix="$WASM_PREFIX" --with-build-cc=cc \
      --without-shared --without-cxx --without-cxx-binding \
      --without-ada --without-progs --without-tests --without-manpages \
      --without-debug --enable-widec --disable-database --disable-stripping \
      --with-fallbacks=xterm-256color,xterm,vt100,dumb
    homescoop_fix_darwin_ar Makefile
    # Some nested Makefiles also get AR=libtool on Darwin.
    find . -name Makefile -print0 | while IFS= read -r -d '' mf; do
      homescoop_fix_darwin_ar "$mf"
    done
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" libs
    emmake make install.libs install.includes
  )
fi
test -f "$WASM_PREFIX/lib/libncursesw.a"

# --- less ---
homescoop_extract "$LESS_TB" "$LESS_SRC"
SLICC_A="$WORK/libslicc-less.a"
homescoop_slicc_archive "$SLICC_A" less

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1048576 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
CLI_LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports)"

if [[ ! -f "$LESS_SRC/less" && ! -f "$LESS_SRC/less.js" || -n "${FORCE:-}" ]]; then
  echo "== less: emconfigure + emmake"
  (
    cd "$LESS_SRC"
    if [[ -f Makefile ]]; then
      make distclean >/dev/null 2>&1 || true
    fi
    CPPFLAGS="-I$WASM_PREFIX/include -I$WASM_PREFIX/include/ncursesw" \
      LDFLAGS="-L$WASM_PREFIX/lib" \
      emconfigure ./configure --host=wasm32-unknown-emscripten \
        --with-regex=posix --with-secure
    homescoop_fix_darwin_ar Makefile
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
      LIBS="-lncursesw $SLICC_A $CLI_LDFLAGS" less
  )
fi
test -f "$LESS_SRC/less" || test -f "$LESS_SRC/less.js"
homescoop_stage_cli "$LESS_SRC" less
echo "== less: staged → $HOMESCOOP_PKG/package"
