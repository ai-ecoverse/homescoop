#!/usr/bin/env bash
# util-linux text tools: rev, column (+ static libsmartcols), hexdump, colrm,
# look, getopt. Nothing that needs a real kernel interface.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe util-linux

TB="$WORK/util-linux-$VERSION.tar.xz"
SRC="$WORK/util-linux-$VERSION"
PROGS=(rev column hexdump colrm look getopt)

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC"; fi
homescoop_extract "$TB" "$SRC"
homescoop_apply_patches "$SRC"

SLICC_A="$WORK/libslicc-util-linux.a"
homescoop_slicc_archive "$SLICC_A" gaps
export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=262144 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
CLI_LDFLAGS="$(homescoop_slicc_keep_exports) $(homescoop_em_cli_ldflags) -Wl,--whole-archive $SLICC_A -Wl,--no-whole-archive"

# --disable-all-programs also forces rev, colrm, look, getopt and column off,
# and they have no --enable-<name> to turn them back on (UL_BUILD_INIT with
# yes/check). Let those five ignore the all-programs default.
perl -0pi -e 's/(enable_(rev|colrm|look|getopt|column)=\$ul_default_estate\n\s*build_\2=yes\n\s*if test "x\$ul_default_estate" = xno)(?! &&)/$1 && false/g' "$SRC/configure"
[[ "$(grep -c '= xno && false' "$SRC/configure")" == 5 ]] || {
  echo "util-linux: configure patch for rev/colrm/look/getopt/column did not apply" >&2
  exit 1
}

# Emscripten's <sys/syscall.h> names SYS_* (as __syscall_* functions) but
# there is no syscall(); util-linux calls syscall(SYS_x) whenever SYS_x is
# defined. Undefine every SYS_*/__NR_* it uses so it takes its fallbacks.
NOSYS="$SRC/homescoop-nosyscall.h"
{
  echo '#include <sys/syscall.h>'
  grep -rhoE '\b(SYS|__NR)_[a-z0-9_]+' "$SRC"/include "$SRC"/lib "$SRC"/text-utils \
    "$SRC"/misc-utils "$SRC"/libsmartcols | sort -u | sed 's/^/#undef /'
} > "$NOSYS"

if [[ ! -f "$SRC/rev.wasm" || -n "${FORCE:-}" ]]; then
  echo "== util-linux: emconfigure (text tools only)"
  (
    cd "$SRC"
    if [[ -f Makefile ]]; then make distclean >/dev/null 2>&1 || true; fi
    BUILD_TRIPLE="$(cc -dumpmachine 2>/dev/null || echo x86_64-pc-linux-gnu)"
    env -u LDFLAGS -u CFLAGS -u CPPFLAGS -u LIBS \
      emconfigure ./configure \
        --build="$BUILD_TRIPLE" --host=wasm32-unknown-emscripten \
        --disable-shared --enable-static \
        --disable-all-programs \
        --enable-libsmartcols --enable-column --enable-hexdump \
        --disable-nls --disable-asciidoc --disable-poman \
        --disable-bash-completion --disable-makeinstall-chown \
        --disable-makeinstall-setuid \
        --without-python --without-systemd --without-udev \
        --without-ncursesw --without-ncurses --without-tinfo \
        --without-readline --without-libz --without-libmagic \
        --without-econf --without-cap-ng --without-btrfs --without-user \
        --without-selinux --without-audit \
        CFLAGS="-O2 -include $NOSYS"
    homescoop_fix_darwin_ar Makefile
    jobs="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
    # libtool drops emcc's -s… link flags from LDFLAGS (no callMain in the
    # glue); it keeps the compiler command whole, so link through CCLD.
    emmake make -j"$jobs" V=1 "${PROGS[@]}" CCLD="emcc $CLI_LDFLAGS"
  )
  # A disabled program still has a link rule, with no objects: catch that.
  for p in "${PROGS[@]}"; do
    grep -q "^S\\[\"BUILD_$(echo "$p" | tr a-z A-Z)_TRUE\"\\]=\"\"" "$SRC/config.status" || {
      echo "util-linux: $p is not enabled by configure" >&2
      exit 1
    }
  done
fi

for p in "${PROGS[@]}"; do
  if [[ -f "$SRC/$p.js" ]]; then mv "$SRC/$p.js" "$SRC/$p"; fi
  test -f "$SRC/$p.wasm"
  homescoop_stage_cli "$SRC" "$p"
done

# Mixed licenses (README.licensing): GPL-2.0-or-later default, BSD-4-Clause-UC
# for rev/column/hexdump/colrm/look, LGPL-2.1-or-later for libsmartcols.
LIC="$WORK/util-linux-LICENSE"
{
  cat "$SRC/README.licensing"
  for f in COPYING Documentation/licenses/COPYING.LGPL-2.1-or-later \
    Documentation/licenses/COPYING.BSD-4-Clause-UC \
    Documentation/licenses/COPYING.BSD-3-Clause \
    Documentation/licenses/COPYING.BSD-2-Clause \
    Documentation/licenses/COPYING.MIT; do
    printf '\n\n==== %s ====\n\n' "$(basename "$f")"
    cat "$SRC/$f"
  done
} > "$LIC"
homescoop_stage_license "$LIC"
echo "== util-linux: staged → $HOMESCOOP_PKG/package ($VERSION)"
