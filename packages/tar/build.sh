#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe tar

TB="$WORK/tar-$VER.tar.xz"
SRC="$WORK/tar-$VER"

homescoop_fetch "$URL" "$SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC"; fi
homescoop_extract "$TB" "$SRC"

# GNU tar forks gzip/bzip2/xz for -z/-j/-J; needs ASYNCIFY fork like bash.
# Full fork profile: spawn+exec+fork+signals+gaps+select (wait4 via spawn).
SLICC_A="$WORK/libslicc-fork.a"
homescoop_slicc_archive "$SLICC_A" fork

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1048576 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain,sliccRunMain,sliccForkChild $(homescoop_slicc_fork_js_flags)"
# whole-archive so spawn/exec/wait4 beat libc's weak ENOSYS stubs (libstubs.a).
CLI_LDFLAGS="$(homescoop_slicc_link_archive "$SLICC_A") $(homescoop_em_cli_ldflags)"
export ac_cv_func_getcwd=yes ac_cv_func_sigaction=yes
export ac_cv_func_mbrtoc32=yes ac_cv_func_c32rtomb=yes
# Cross / wasm: skip root-privilege mknod probe (and euid==0 false positives).
export FORCE_UNSAFE_CONFIGURE=1
export gl_cv_func_mknod_works=yes
# Stock emsdk run-probes hang on sleep/nanosleep under node.
export gl_cv_func_nanosleep=yes
export ac_cv_func_sleep=yes
export gl_cv_func_working_sleep=yes
# Avoid other long-running / false-negative gnulib run-tests.
export gl_cv_func_working_mktime=yes
export ac_cv_func_alarm=yes
# Emscripten has no initgroups; rtapelib references it when the probe says yes.
export ac_cv_func_initgroups=no

if [[ ! -f "$SRC/src/tar" && ! -f "$SRC/src/tar.js" || -n "${FORCE:-}" ]]; then
  echo "== tar: emconfigure + emmake"
  (
    cd "$SRC"
    if [[ -f Makefile ]]; then make distclean >/dev/null 2>&1 || true; fi
    # Explicit --build avoids gnulib run-tests that hang under node (sleep, etc.).
    emconfigure ./configure \
      --build=x86_64-pc-linux-gnu --host=wasm32-unknown-emscripten \
      --disable-nls --without-selinux --disable-acl
    homescoop_fix_darwin_ar Makefile
    # Stub initgroups if rtapelib still references it (config cache races).
    STUB="$WORK/tar-initgroups-stub.c"
    cat >"$STUB" <<'EOF'
#include <sys/types.h>
int initgroups(const char *user, gid_t group) { (void)user; (void)group; return 0; }
EOF
    emcc -O2 -c "$STUB" -o "$WORK/tar-initgroups-stub.o"
    # shellcheck disable=SC2086
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
      LDFLAGS="$WORK/tar-initgroups-stub.o $CLI_LDFLAGS"
  )
fi
STAGE="$SRC/src"
if [[ -f "$STAGE/tar.js" && ! -f "$STAGE/tar" ]]; then mv "$STAGE/tar.js" "$STAGE/tar"; fi
test -f "$STAGE/tar.wasm" || test -f "$STAGE/tar"
homescoop_stage_cli "$STAGE" tar
homescoop_stage_license "$SRC"/COPYING "$SRC"/LICENSE
echo "== tar: staged → $HOMESCOOP_PKG/package"
