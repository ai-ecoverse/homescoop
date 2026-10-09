#!/usr/bin/env bash
# GNU binutils: strings, size, readelf (static libbfd, limited targets).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe binutils

TB="$WORK/binutils-$VERSION.tar.xz"
SRC="$WORK/binutils-$VERSION"
BLD="$WORK/binutils-build"
PROGS=(strings size readelf)
TARGETS="x86_64-pc-linux-gnu,i686-pc-linux-gnu,aarch64-linux-gnu,wasm32"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC" "$BLD"; fi
homescoop_extract "$TB" "$SRC"
homescoop_apply_patches "$SRC"

SLICC_A="$WORK/libslicc-binutils.a"
homescoop_slicc_archive "$SLICC_A" gaps
export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1048576 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
CLI_LDFLAGS="$(homescoop_slicc_keep_exports) $(homescoop_em_cli_ldflags) -Wl,--whole-archive $SLICC_A -Wl,--no-whole-archive"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"

if [[ ! -f "$BLD/binutils/strings.wasm" || -n "${FORCE:-}" ]]; then
  echo "== binutils: emconfigure (strings/size/readelf; targets $TARGETS)"
  rm -rf "$BLD"
  mkdir -p "$BLD"
  (
    cd "$BLD"
    BUILD_TRIPLE="$(cc -dumpmachine 2>/dev/null || echo x86_64-pc-linux-gnu)"
    # musl has these, but emsdk link probes say no and libiberty's own
    # psignal/getpagesize then clash with the libc prototypes. Exported:
    # subdirectories are configured later, from make.
    export ac_cv_func_psignal=yes ac_cv_func_getpagesize=yes
    env -u LDFLAGS -u CFLAGS -u CPPFLAGS -u LIBS \
      CC_FOR_BUILD=cc CXX_FOR_BUILD=c++ \
      emconfigure "$SRC/configure" \
        --build="$BUILD_TRIPLE" --host=wasm32-unknown-emscripten \
        --target=x86_64-pc-linux-gnu --enable-targets="$TARGETS" \
        --disable-shared --enable-static \
        --disable-gdb --disable-gdbserver --disable-sim --disable-ld \
        --disable-gold --disable-gas --disable-gprof --disable-gprofng \
        --disable-libdecnumber --disable-readline --disable-libctf \
        --disable-plugins --disable-nls --disable-werror \
        --without-zstd --without-debuginfod --without-msgpack \
        --without-system-zlib --with-mmap=no \
        CFLAGS="-O2"
    find . -name Makefile -print0 | while IFS= read -r -d '' mf; do
      homescoop_fix_darwin_ar "$mf"
    done
    emmake make -j"$JOBS" all-libiberty all-zlib all-libsframe all-bfd configure-binutils
    # libtool drops emcc's -s… link flags from LDFLAGS; it keeps the
    # compiler command whole, so link through CCLD (as util-linux).
    emmake make -C binutils -j"$JOBS" V=1 "${PROGS[@]}" CCLD="emcc $CLI_LDFLAGS"
  )
fi

for p in "${PROGS[@]}"; do
  if [[ -f "$BLD/binutils/$p.js" ]]; then mv "$BLD/binutils/$p.js" "$BLD/binutils/$p"; fi
  test -f "$BLD/binutils/$p.wasm"
  homescoop_stage_cli "$BLD/binutils" "$p"
done
homescoop_stage_license "$SRC"/COPYING3
# --without-system-zlib: BFD links the zlib copy in the binutils tree.
ZVER="$(sed -n 's/^#define ZLIB_VERSION "\(.*\)"$/\1/p' "$SRC/zlib/zlib.h")"
test -n "$ZVER"
homescoop_notices_begin "The strings, size and readelf wasm modules statically link the following."
homescoop_notice "zlib $ZVER (bundled in binutils $VERSION)" \
  https://raw.githubusercontent.com/madler/zlib/v1.3.1/LICENSE 845efc77857d485d91fb3e0b884aaa929368c717ae8186b66fe1ed2495753243
homescoop_notice_emscripten
echo "== binutils: staged → $HOMESCOOP_PKG/package ($VERSION)"
