#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe procps

# Dist dir is procps-ng-<ver>/ (recipe name is procps).
TB="$WORK/procps-ng-$VERSION.tar.xz"
SRC="$WORK/procps-ng-$VERSION"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC"; fi
homescoop_extract "$TB" "$SRC"
homescoop_apply_patches "$SRC"

SLICC_A="$WORK/libslicc-cli.a"
homescoop_slicc_archive "$SLICC_A" cli

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1048576 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
# slicc_pwd.c answers getpwuid/getpwnam only through --wrap: without it ps
# shows USER as a number (homescoop#207).
CLI_LDFLAGS="$(homescoop_slicc_keep_exports) $(homescoop_slicc_keep_spawn) $(homescoop_slicc_wrap_pwd) $(homescoop_em_cli_ldflags)"
CLI_LIBS="-Wl,--whole-archive ${SLICC_A} -Wl,--no-whole-archive"

# Honest malloc/realloc probes — avoid rpl_malloc/rpl_realloc without gnulib objs.
export ac_cv_func_malloc_0_nonnull=yes
export ac_cv_func_realloc_0_nonnull=yes
export ac_cv_func_getcwd=yes ac_cv_func_sigaction=yes
export ac_cv_func_sigprocmask=yes ac_cv_func_kill=yes

STUB_O="$WORK/procps-wasm-stubs.o"
if [[ ! -f "$STUB_O" || -n "${FORCE:-}" ]]; then
  echo "== procps: emcc wasm-stubs.c"
  emcc -O2 -c "$HOMESCOOP_PKG/wasm-stubs.c" -o "$STUB_O"
fi

need_build=0
if [[ ! -f "$SRC/src/ps/pscommand" && ! -f "$SRC/src/ps/pscommand.js" ]] || [[ -n "${FORCE:-}" ]]; then
  need_build=1
fi

if [[ "$need_build" -eq 1 ]]; then
  echo "== procps: emconfigure + emmake"
  (
    cd "$SRC"
    if [[ -f Makefile ]]; then make distclean >/dev/null 2>&1 || true; fi
    env -u LDFLAGS -u CFLAGS -u CPPFLAGS -u LIBS \
      emconfigure ./configure \
        --build=x86_64-pc-linux-gnu --host=wasm32-unknown-emscripten \
        --disable-nls --disable-rpath \
        --disable-shared --enable-static \
        --without-ncurses \
        --without-systemd --without-elogind \
        --disable-w --disable-pidwait \
        --enable-pidof --enable-kill \
        CFLAGS="-O2"
    homescoop_fix_darwin_ar Makefile
    jobs="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
    # Library only — clear LIBS/LDFLAGS so ambient env / slicc stubs never
    # get absorbed into libproc2.la (libtool rejects non-.lo members on Linux).
    # shellcheck disable=SC2086
    env -u LIBS -u LDFLAGS emmake make -j"$jobs" LIBS= LDFLAGS= library/libproc2.la
    # Final CLIs: slicc + stubs. -o libproc2.la stops make from re-entering
    # the libtool archive rule with LIBS=stubs (which fails on Linux CI).
    # shellcheck disable=SC2086
    emmake make -j"$jobs" \
      -o library/libproc2.la -o library/.libs/libproc2.a \
      LDFLAGS="$CLI_LDFLAGS" \
      LIBS="$CLI_LIBS $STUB_O" \
      src/ps/pscommand src/free src/pgrep src/pkill src/kill src/uptime src/pidof
  )
fi

stage_one() {
  local srcdir="$1" name="$2" destname="${3:-$2}"
  if [[ -f "$srcdir/$name.js" && ! -f "$srcdir/$name" ]]; then
    mv "$srcdir/$name.js" "$srcdir/$name"
  fi
  test -f "$srcdir/$name" || test -f "$srcdir/$name.wasm"
  if [[ "$name" != "$destname" ]]; then
    cp "$srcdir/$name" "$srcdir/$destname"
    [[ -f "$srcdir/$name.wasm" ]] && cp "$srcdir/$name.wasm" "$srcdir/$destname.wasm"
  fi
  homescoop_stage_cli "$srcdir" "$destname"
}

stage_one "$SRC/src/ps" pscommand ps
for c in free pgrep pkill kill uptime pidof; do
  stage_one "$SRC/src" "$c"
done

homescoop_stage_license "$SRC"/COPYING "$SRC"/COPYING.LIB "$SRC"/LICENSE
echo "== procps: staged → $HOMESCOOP_PKG/package"
