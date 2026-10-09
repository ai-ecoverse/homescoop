#!/usr/bin/env bash
# rsync: local copies (fork profile + ASYNCIFY, bundled zlib and popt).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe rsync

TB="$WORK/rsync-$VERSION.tar.gz"
SRC="$WORK/rsync-$VERSION"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC"; fi
homescoop_extract "$TB" "$SRC"
homescoop_apply_patches "$SRC"

# A local rsync forks the receiver, which forks the generator; all three talk
# over pipes at once. On slicc-kernel fork starts a real process (netfork
# profile: fork + ASYNCIFY as in bash/tar, plus the socket shim for rsync://
# and the daemon, and slicc_pwd/getpass).
SLICC_A="$WORK/libslicc-rsync-netfork.a"
homescoop_slicc_archive "$SLICC_A" netfork
export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1048576 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain,sliccRunMain,sliccForkChild -lnodefs.js $(homescoop_slicc_fork_js_flags)"
# select() waits in the kernel too (see slicc_rsync_select.c).
SELECT_O="$WORK/slicc_rsync_select.o"
emcc -O2 -c "$HOMESCOOP_PKG/slicc_rsync_select.c" -o "$SELECT_O"
CLI_LDFLAGS="$SELECT_O $(homescoop_slicc_link_archive "$SLICC_A") $(homescoop_em_cli_ldflags)"

# Cross build: configure cannot run its test programs. Answers for
# emscripten's musl (pipes rather than socketpair, which emscripten lacks).
export rsync_cv_HAVE_BROKEN_LARGEFILE=no
export rsync_cv_MAKEDEV_TAKES_3_ARGS=no
export rsync_cv_chown_modifies_symlink=no
export rsync_cv_can_hardlink_symlink=no
export rsync_cv_can_hardlink_special=no
export rsync_cv_HAVE_SOCKETPAIR=no
export rsync_cv_HAVE_BROKEN_READDIR=no
export rsync_cv_HAVE_C99_VSNPRINTF=yes
export rsync_cv_HAVE_SECURE_MKSTEMP=yes
export rsync_cv_MKNOD_CREATES_FIFOS=no
export rsync_cv_MKNOD_CREATES_SOCKETS=no
# netfork brings getpass (slicc_getpass.c); rsync must not build lib/getpass.o.
export ac_cv_func_getpass=yes

if [[ ! -f "$SRC/rsync.wasm" || -n "${FORCE:-}" ]]; then
  echo "== rsync: emconfigure + emmake"
  (
    cd "$SRC"
    if [[ -f Makefile ]]; then make distclean >/dev/null 2>&1 || true; fi
    emconfigure ./configure \
      --build=x86_64-pc-linux-gnu --host=wasm32-unknown-emscripten \
      --with-included-popt --with-included-zlib \
      --disable-openssl --disable-xxhash --disable-zstd --disable-lz4 \
      --disable-md2man --disable-iconv --disable-iconv-open --disable-locale \
      --disable-acl-support --disable-xattr-support --disable-ipv6 \
      --disable-roll-simd --disable-md5-asm --disable-roll-asm
    homescoop_fix_darwin_ar Makefile
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
      rsync CPPFLAGS="-Dselect=slicc_rsync_select" LDFLAGS="$CLI_LDFLAGS"
  )
fi
test -f "$SRC/rsync.wasm"
homescoop_stage_cli "$SRC" rsync
homescoop_stage_license "$SRC"/COPYING
homescoop_notices_begin "The rsync wasm module statically links the following."
# zlib's licence is the opening comment of zlib.h.
sed -n '1,/^\*\//p' "$SRC/zlib/zlib.h" >"$WORK/notices/rsync-zlib-license.txt"
homescoop_notice "zlib 1.2.8 (bundled in rsync's zlib/, modified by the rsync authors)" \
  "$WORK/notices/rsync-zlib-license.txt" -
homescoop_notice "popt (bundled in rsync's popt/)" \
  "$SRC/popt/COPYING" -
homescoop_notice_emscripten
echo "== rsync: staged → $HOMESCOOP_PKG/package ($VERSION)"
