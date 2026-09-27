#!/usr/bin/env bash
# GNU bash 5.3 — port of slicc-emscripten/build-wasm-bash.sh.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
HOMESCOOP_PKG="$ROOT/packages/bash"
VERSION=5.3
SRC_URL=https://ftp.gnu.org/gnu/bash/bash-5.3.tar.gz
SRC_SHA=0d5cd86965f869a26cf64f4b71be7b96f90a3ba8b3d74e27e8e9d9d5550f31ba
SRC_DIR="$WORK/bash-$VERSION"
TARBALL="$WORK/bash-$VERSION.tar.gz"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"

PATCH="$ROOT/patches/bash-5.3-emscripten-environ.patch"
marker="$SRC_DIR/.homescoop-patched-environ"
if [[ -f "$PATCH" && ! -f "$marker" ]]; then
  echo "== patch bash environ"
  patch -d "$SRC_DIR" -p1 < "$PATCH"
  touch "$marker"
fi

SLICC_A="$WORK/libslicc-fork.a"
homescoop_slicc_archive "$SLICC_A" fork

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1048576 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain,sliccRunMain,sliccForkChild $(homescoop_slicc_fork_js_flags)"
LINK="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports) $SLICC_A"

export bash_cv_wexitstatus_offset=8 bash_cv_dev_fd=absent bash_cv_dev_stdin=absent \
  bash_cv_signal_vintage=posix bash_cv_getcwd_malloc=yes ac_cv_header_sys_random_h=no

if [[ ! -f "$SRC_DIR/bash" && ! -f "$SRC_DIR/bash.js" || -n "${FORCE:-}" ]]; then
  echo "== bash: emconfigure + emmake"
  (
    cd "$SRC_DIR"
    if [[ -f Makefile ]]; then
      make distclean >/dev/null 2>&1 || true
    fi
    emconfigure ./configure --host=wasm32-unknown-emscripten --without-bash-malloc \
      --disable-nls --disable-readline --disable-history \
      CC_FOR_BUILD=cc
    homescoop_fix_darwin_ar Makefile
    rm -f bash bash.wasm shell.o
    # Signal names from the target's <signal.h> (cross mode): mksignames on
    # the host would bake macOS numbers (SIGUSR1=30, SIGCHLD=20).
    if ! grep -q 'extern char \*signal_names' lsignames.h 2>/dev/null; then
      rm -f lsignames.h signames.h mksignames mksignames.o buildsignames.o signames.o trap.o
    fi
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
      ADDON_LDFLAGS="$LINK" LDFLAGS_FOR_BUILD= \
      LOCAL_DEFS="-DSHELL -DCROSS_COMPILING" SIGNAMES_O=signames.o
  )
fi
test -f "$SRC_DIR/bash" || test -f "$SRC_DIR/bash.js"
homescoop_stage_cli "$SRC_DIR" bash
echo "== bash: staged → $HOMESCOOP_PKG/package"
