#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe diffutils

TB="$WORK/diffutils-$VER.tar.xz"
SRC="$WORK/diffutils-$VER"

homescoop_fetch "$URL" "$SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC"; fi
homescoop_extract "$TB" "$SRC"

# diff3 forks and execs diff; sdiff execs it. The fork profile (Asyncify),
# linked whole-archive so execve/posix_spawn are slicc's, not Emscripten's
# stubs (which gave "diff3: fork: Function not implemented" and
# "sdiff: diff: Exec format error").
SLICC_A="$WORK/libslicc-diffutils-fork.a"
homescoop_slicc_archive "$SLICC_A" fork

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=524288 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain,sliccRunMain,sliccForkChild $(homescoop_slicc_fork_js_flags)"
CLI_LDFLAGS="$(homescoop_slicc_link_archive "$SLICC_A") $(homescoop_em_cli_ldflags)"
export ac_cv_func_getcwd=yes ac_cv_func_sigaction=yes
# Force yes on the configure cmdline — emconfigure probes can ignore exports.
export ac_cv_func_mbrtoc32=yes ac_cv_func_c32rtomb=yes
export gl_cv_func_mbrtoc32=yes gl_cv_func_c32rtomb=yes
export gl_cv_func_nanosleep=yes ac_cv_func_sleep=yes gl_cv_func_working_sleep=yes
# Cross-compile: gnulib refuses "guessing yes" for some funcs.
export gl_cv_func_strcasecmp_works=yes
export gl_cv_func_strncasecmp_works=yes

if [[ ! -f "$SRC/src/diff" && ! -f "$SRC/src/diff.js" || -n "${FORCE:-}" ]]; then
  echo "== diffutils: emconfigure + emmake"
  (
    cd "$SRC"
    if [[ -f Makefile ]]; then make distclean >/dev/null 2>&1 || true; fi
    emconfigure ./configure \
      --build=x86_64-pc-linux-gnu --host=wasm32-unknown-emscripten \
      --disable-nls \
      ac_cv_func_mbrtoc32=yes ac_cv_func_c32rtomb=yes \
      gl_cv_func_mbrtoc32=yes gl_cv_func_c32rtomb=yes
    homescoop_fix_darwin_ar Makefile
    # shellcheck disable=SC2086
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
      LDFLAGS="$CLI_LDFLAGS"
  )
fi

STAGE="$SRC/src"
for cmd in diff cmp diff3 sdiff; do
  if [[ -f "$STAGE/$cmd.js" && ! -f "$STAGE/$cmd" ]]; then
    mv "$STAGE/$cmd.js" "$STAGE/$cmd"
  fi
  test -f "$STAGE/$cmd" || test -f "$STAGE/$cmd.wasm"
  homescoop_stage_cli "$STAGE" "$cmd"
done
homescoop_stage_license "$SRC"/COPYING "$SRC"/LICENSE
homescoop_notices_begin "The diff, cmp, diff3 and sdiff wasm modules statically link the following."
homescoop_notice_emscripten
echo "== diffutils: staged → $HOMESCOOP_PKG/package"
