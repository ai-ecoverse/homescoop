#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe findutils

TB="$WORK/findutils-$VER.tar.xz"
SRC="$WORK/findutils-$VER"

homescoop_fetch "$URL" "$SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC"; fi
homescoop_extract "$TB" "$SRC"
homescoop_apply_patches "$SRC"

# find -exec / xargs -P: fork + execvp → slicc_fork + slicc_exec → slicc_spawn.
SLICC_A="$WORK/libslicc-fork.a"
homescoop_slicc_archive "$SLICC_A" fork

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1048576 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain,sliccRunMain,sliccForkChild -lnodefs.js $(homescoop_slicc_fork_js_flags)"
CLI_LDFLAGS="$(homescoop_slicc_link_archive "$SLICC_A") $(homescoop_em_cli_ldflags)"

export ac_cv_func_getcwd=yes ac_cv_func_sigaction=yes
export ac_cv_func_mbrtoc32=yes ac_cv_func_c32rtomb=yes
export gl_cv_func_mbrtoc32=yes gl_cv_func_c32rtomb=yes
export gl_cv_func_nanosleep=yes ac_cv_func_sleep=yes gl_cv_func_working_sleep=yes
export gl_cv_func_working_mktime=yes
export ac_cv_func_alarm=yes
# Cross / wasm: skip root-privilege and false-negative gnulib probes.
export FORCE_UNSAFE_CONFIGURE=1
export gl_cv_func_mknod_works=yes
export gl_cv_func_strcasecmp_works=yes
export gl_cv_func_strncasecmp_works=yes

if [[ ! -f "$SRC/find/find" && ! -f "$SRC/find/find.js" || -n "${FORCE:-}" ]]; then
  echo "== findutils: emconfigure + emmake (find + xargs only)"
  (
    cd "$SRC"
    if [[ -f Makefile ]]; then make distclean >/dev/null 2>&1 || true; fi
    emconfigure ./configure \
      --build=x86_64-pc-linux-gnu --host=wasm32-unknown-emscripten \
      --disable-nls --disable-rpath
    homescoop_fix_darwin_ar Makefile
    # Skip locate/updatedb (and docs/po/tests) — only find + xargs.
    # shellcheck disable=SC2086
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
      -C gl \
      LDFLAGS="$CLI_LDFLAGS"
    # shellcheck disable=SC2086
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
      -C lib \
      LDFLAGS="$CLI_LDFLAGS"
    # shellcheck disable=SC2086
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
      -C find \
      LDFLAGS="$CLI_LDFLAGS"
    # shellcheck disable=SC2086
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
      -C xargs \
      LDFLAGS="$CLI_LDFLAGS"
  )
fi

for cmd_dir in find xargs; do
  STAGE="$SRC/$cmd_dir"
  cmd="$cmd_dir"
  if [[ -f "$STAGE/$cmd.js" && ! -f "$STAGE/$cmd" ]]; then
    mv "$STAGE/$cmd.js" "$STAGE/$cmd"
  fi
  test -f "$STAGE/$cmd" || test -f "$STAGE/$cmd.wasm"
  homescoop_stage_cli "$STAGE" "$cmd"
done
homescoop_stage_license "$SRC"/COPYING "$SRC"/LICENSE
echo "== findutils: staged → $HOMESCOOP_PKG/package"
