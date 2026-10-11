#!/usr/bin/env bash
# GNU bash + readline/history over static ncursesw — port of
# slicc-emscripten/build-wasm-bash-readline.sh.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe bash
homescoop_load_recipe bash --source ncurses
SRC_DIR="$WORK/bash-$VERSION"
TARBALL="$WORK/bash-$VERSION.tar.gz"

NC_TB="$WORK/ncurses-$NCURSES_VER.tar.gz"
NC_SRC="$WORK/ncurses-$NCURSES_VER"
HOST_PREFIX="$WORK/ncurses-host"
WASM_PREFIX="$WORK/ncurses-wasm-prefix"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
homescoop_fetch "$NCURSES_URL" "$NCURSES_SHA" "$NC_TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"
homescoop_apply_patches "$SRC_DIR"

# Cap parallelism: bash's recursive make + emcc can exhaust macOS job pipes
# ("read jobs pipe: Resource temporarily unavailable") at high -j.
JOBS="${HOMESCOOP_JOBS:-4}"
jobs_n() { echo "$JOBS"; }

# --- host tic/infocmp (shared with wasm-less) ---
if [[ ! -x "$HOST_PREFIX/bin/tic" ]]; then
  echo "== bash: native ncurses (tic/infocmp)"
  HOST_SRC="$WORK/ncurses-host-src"
  rm -rf "$HOST_SRC"
  mkdir -p "$HOST_SRC"
  tar xzf "$NC_TB" -C "$HOST_SRC"
  (
    cd "$HOST_SRC/ncurses-$NCURSES_VER"
    ./configure --prefix="$HOST_PREFIX" \
      --without-shared --without-cxx --without-ada --without-tests \
      --without-manpages --enable-widec
    make -j"$(jobs_n)"
    make install.progs
  )
fi
test -x "$HOST_PREFIX/bin/tic"

# --- wasm ncurses with compiled-in fallbacks (same as less) ---
# Only rebuild ncurses when FORCE_NCURSES=1 or the archive is missing.
homescoop_extract "$NC_TB" "$NC_SRC"
MKF="$NC_SRC/ncurses/tinfo/MKfallback.sh"
if [[ -f "$MKF" ]] && grep -q 's/\\<short\\>/NCURSES_INT2/g' "$MKF"; then
  echo "== bash: patch MKfallback.sh for portable sed"
  perl -i -pe 's#s/\\<short\\>/NCURSES_INT2/g#s/^static short /static NCURSES_INT2 /#' "$MKF"
fi

if [[ ! -f "$WASM_PREFIX/lib/libncursesw.a" || -n "${FORCE_NCURSES:-}" ]]; then
  echo "== bash: emconfigure ncurses (widec, fallbacks)"
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
      --without-ada --without-progs --without-tests --without-manpages \
      --without-debug --enable-widec --disable-database --disable-stripping \
      --with-fallbacks=xterm-256color,xterm,vt100,dumb
    homescoop_fix_darwin_ar Makefile
    while IFS= read -r -d '' mf; do
      homescoop_fix_darwin_ar "$mf"
    done < <(find . -name Makefile -print0)
    emmake make -j"$(jobs_n)" libs
    emmake make install.libs install.includes
  )
fi
test -f "$WASM_PREFIX/lib/libncursesw.a"
# bash configure looks for -lncurses / -ltinfo; point them at widec.
ln -sf libncursesw.a "$WASM_PREFIX/lib/libncurses.a"
ln -sf libncursesw.a "$WASM_PREFIX/lib/libtinfo.a"

# netfork = fork + slicc_socket.c (+ select, jobs): /dev/tcp and /dev/udp go
# through the kernel's sockets and resolver (#140/#149), not Emscripten's
# WebSocket SOCKFS ("Host is unreachable"). Whole-archive (link_archive) so
# the socket syscalls win. slicc_getpass.c comes along; bash never calls it.
SLICC_A="$WORK/libslicc-netfork.a"
homescoop_slicc_archive "$SLICC_A" netfork

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1048576 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,ENV,callMain,sliccRunMain,sliccForkChild -lnodefs.js $(homescoop_slicc_fork_js_flags)"
LINK="$(homescoop_slicc_link_archive "$SLICC_A") $(homescoop_em_cli_ldflags)"

export bash_cv_wexitstatus_offset=8 bash_cv_dev_fd=standard bash_cv_dev_stdin=absent \
  bash_cv_signal_vintage=posix bash_cv_getcwd_malloc=yes ac_cv_header_sys_random_h=no

if [[ ! -f "$SRC_DIR/bash" && ! -f "$SRC_DIR/bash.js" || -n "${FORCE:-}" ]]; then
  echo "== bash: emconfigure + emmake (readline + history + curses)"
  (
    cd "$SRC_DIR"
    if [[ -f Makefile ]]; then
      make distclean >/dev/null 2>&1 || true
    fi
    CPPFLAGS="-I$WASM_PREFIX/include -I$WASM_PREFIX/include/ncursesw" \
      LDFLAGS="-L$WASM_PREFIX/lib" \
      emconfigure ./configure --host=wasm32-unknown-emscripten --without-bash-malloc \
        --disable-nls --with-curses --enable-readline --enable-history \
        --without-installed-readline \
        CC_FOR_BUILD=cc
    homescoop_fix_darwin_ar Makefile
    rm -f bash bash.wasm shell.o
    if ! grep -q 'extern char \*signal_names' lsignames.h 2>/dev/null; then
      rm -f lsignames.h signames.h mksignames mksignames.o buildsignames.o signames.o trap.o
    fi
    emmake make -j"$(jobs_n)" \
      ADDON_LDFLAGS="$LINK" LDFLAGS_FOR_BUILD= \
      LOCAL_DEFS="-DSHELL -DCROSS_COMPILING" SIGNAMES_O=signames.o
  )
fi
test -f "$SRC_DIR/bash" || test -f "$SRC_DIR/bash.js"
homescoop_stage_cli "$SRC_DIR" bash
homescoop_stage_license "$SRC_DIR"/COPYING "$SRC_DIR"/LICENSE
homescoop_notices_begin "bash.wasm statically links the following. (readline and history are part of bash, under bash's own GPL-3.0-or-later.)"
homescoop_notice "ncurses $NCURSES_VER (built from the pinned source tarball)" "$NC_SRC"/COPYING -
homescoop_notice_emscripten
# GPL-3.0 §5: name every modification of bash. Generated from the patches the
# build applied (homescoop_apply_patches), so the list cannot drift.
{
  printf '\n## Modifications to GNU bash %s (GPL-3.0-or-later)\n\n' "$VERSION"
  printf 'bash.wasm is GNU bash %s with these patches, applied in this order; their\n' "$VERSION"
  printf 'sources are in https://github.com/ai-ecoverse/homescoop/tree/main/packages/bash.\n\n'
  for p in "$HOMESCOOP_PKG"/*.patch; do
    files="$(grep -E '^\+\+\+ b/' "$p" | sed 's|^+++ b/||; s|[[:space:]].*||' | sort -u | paste -sd ',' - | sed 's/,/, /g')"
    printf -- '- `%s`: %s\n' "$(basename "$p")" "$files"
  done
} >>"$HOMESCOOP_NOTICES"
echo "== bash: staged → $HOMESCOOP_PKG/package (readline)"
