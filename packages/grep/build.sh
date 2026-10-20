#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe grep
homescoop_load_recipe grep --source pcre2

# grep -P: a static libpcre2-8 (no JIT) for grep's configure, which takes
# PCRE_CFLAGS/PCRE_LIBS as given (homescoop#680).
PCRE2_TB="$WORK/pcre2-$PCRE2_VER.tar.bz2"
PCRE2_SRC="$WORK/pcre2-$PCRE2_VER"
homescoop_fetch "$PCRE2_URL" "$PCRE2_SHA" "$PCRE2_TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$PCRE2_SRC"; fi
if [[ ! -f "$PCRE2_SRC/.libs/libpcre2-8.a" ]]; then
  echo "== grep: PCRE2 $PCRE2_VER (static, 8-bit, no JIT)"
  rm -rf "$PCRE2_SRC"
  tar xjf "$PCRE2_TB" -C "$WORK"
  (
    cd "$PCRE2_SRC"
    emconfigure ./configure --build=x86_64-pc-linux-gnu --host=wasm32-unknown-emscripten \
      --disable-shared --enable-static --disable-jit --enable-pcre2-8 \
      --disable-pcre2-16 --disable-pcre2-32 --disable-pcre2grep-libz --disable-pcre2grep-libbz2 \
      --disable-pcre2test-libedit --disable-pcre2test-libreadline CFLAGS=-O2
    homescoop_fix_darwin_ar Makefile
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" libpcre2-8.la
  )
fi
test -f "$PCRE2_SRC/.libs/libpcre2-8.a"
export PCRE_CFLAGS="-I$PCRE2_SRC/src" PCRE_LIBS="$PCRE2_SRC/.libs/libpcre2-8.a"
export enable_perl_regexp=yes
# shellcheck source=../../scripts/build-gnu-cli.sh
source "$ROOT/scripts/build-gnu-cli.sh"
if ! grep -q '^#define HAVE_LIBPCRE 1' "$SRC_DIR/config.h"; then
  echo "homescoop: grep $VERSION configured without PCRE2: grep -P would fail (homescoop#680)" >&2
  exit 1
fi
homescoop_notices_begin "The wasm modules in bin/ statically link the following."
homescoop_notice "PCRE2 $PCRE2_VER (built from the pinned source tarball)" "$PCRE2_SRC"/LICENCE.md -
homescoop_notice_emscripten
