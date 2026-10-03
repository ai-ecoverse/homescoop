#!/usr/bin/env bash
# Shared host body for GNU userland CLI tools (coreutils, sed, grep, gawk).
# Port of slicc-emscripten/build-wasm-gnu.sh.
# Usage: sourced from packages/<name>/build.sh after homescoop_load_recipe
#   or: bash scripts/build-gnu-cli.sh <name>
set -euo pipefail

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  NAME="${1:?usage: build-gnu-cli.sh <coreutils|sed|grep|gawk>}"
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  export HOMESCOOP_ROOT="$ROOT"
  # shellcheck source=./build-common.sh
  source "$ROOT/scripts/build-common.sh"
  homescoop_load_recipe "$NAME"
else
  : "${NAME:?}" "${VERSION:?}" "${SRC_URL:?}" "${SRC_SHA:?}" "${HOMESCOOP_PKG:?}"
  ROOT="${HOMESCOOP_ROOT:?}"
  # shellcheck source=./build-common.sh
  source "$ROOT/scripts/build-common.sh"
fi

SRC_DIR="$WORK/$NAME-$VERSION"
TARBALL="$WORK/$(basename "$SRC_URL")"
BIN_NAME="$NAME"
# gawk binary is named gawk
[[ "$NAME" == gawk ]] && BIN_NAME=gawk

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"
homescoop_apply_patches "$SRC_DIR"

# cli = spawn+exec+select+jobs (no fork/ASYNCIFY). whole-archive is required:
# emscripten libstubs.a ships a weak execve (ENOEXEC); a bare .a loses to it and
# env/nice/nohup/#!/usr/bin/env all fail with "Exec format error".
# Put the .a in LIBS (not LDFLAGS): gawk's link line carries LDFLAGS twice and
# would duplicate whole-archive members.
SLICC_A="$WORK/libslicc-cli.a"
homescoop_slicc_archive "$SLICC_A" cli

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1048576 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
CLI_LDFLAGS="$(homescoop_slicc_keep_exports) $(homescoop_slicc_keep_spawn) $(homescoop_em_cli_ldflags)"
CLI_LIBS="-Wl,--whole-archive ${SLICC_A} -Wl,--no-whole-archive"

EXTRA_CFG=()
case "$NAME" in
  coreutils) EXTRA_CFG=(--enable-single-binary=symlinks --enable-no-install-program=stdbuf) ;;
  gawk) EXTRA_CFG=(--disable-extensions --disable-mpfr) ;;
esac

# Emscripten's configure mode tolerates undefined symbols; force honest answers.
# Stock emsdk link probes often false-negative (getcwd/sigaction "no") while the
# symbols exist — that pulls in broken gnulib fallbacks (getwd, NSIG<=32).
export ac_cv_func_splice=no ac_cv_func_sethostname=yes gl_cv_func_nanosleep=yes
export ac_cv_func_getcwd=yes ac_cv_func_sigaction=yes
export ac_cv_func_sigprocmask=yes ac_cv_func_sigemptyset=yes
export ac_cv_func_sigaddset=yes ac_cv_func_sigdelset=yes ac_cv_func_sigfillset=yes
export ac_cv_func_sigismember=yes
# Declared in uchar.h but emsdk link probes can false-negative → gnulib clash.
export ac_cv_func_mbrtoc32=yes ac_cv_func_c32rtomb=yes
export gl_cv_func_mbrtoc32=yes gl_cv_func_c32rtomb=yes

if [[ ! -f "$SRC_DIR/$BIN_NAME" && ! -f "$SRC_DIR/$BIN_NAME.js" && ! -f "$SRC_DIR/src/$BIN_NAME" && ! -f "$SRC_DIR/src/$BIN_NAME.js" || -n "${FORCE:-}" ]]; then
  echo "== $NAME: emconfigure + emmake"
  (
    cd "$SRC_DIR"
    if [[ -f Makefile ]]; then
      make distclean >/dev/null 2>&1 || true
    fi
    # Cross build: avoid running gnulib tests under node (hangs on nanosleep/alarm).
    emconfigure ./configure \
      --build=x86_64-pc-linux-gnu --host=wasm32-unknown-emscripten \
      --disable-nls "${EXTRA_CFG[@]}" \
      ac_cv_func_mbrtoc32=yes ac_cv_func_c32rtomb=yes \
      gl_cv_func_mbrtoc32=yes gl_cv_func_c32rtomb=yes
    homescoop_fix_darwin_ar Makefile
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
      LDFLAGS="$CLI_LDFLAGS" LIBS="$CLI_LIBS"
  )
fi

# Locate binary (coreutils → src/, sed → sed/, else top-level)
STAGE_DIR="$SRC_DIR"
for d in "$SRC_DIR/src" "$SRC_DIR/$BIN_NAME" "$SRC_DIR"; do
  if [[ -f "$d/$BIN_NAME" || -f "$d/$BIN_NAME.js" ]]; then
    STAGE_DIR="$d"
    break
  fi
done
test -f "$STAGE_DIR/$BIN_NAME" || test -f "$STAGE_DIR/$BIN_NAME.js"
homescoop_stage_cli "$STAGE_DIR" "$BIN_NAME"

# Guard: slicc execve/popen must win over libstubs. Glue that lacks execWait
# still has the ENOEXEC stub; missing popen means gawk/sed ENOSYS stubs won.
GLUE="$HOMESCOOP_PKG/package/bin/$BIN_NAME"
[[ -f "$GLUE" ]] || GLUE="$HOMESCOOP_PKG/package/bin/$BIN_NAME.js"
if [[ -f "$GLUE" ]] && ! grep -q 'execWait' "$GLUE"; then
  echo "homescoop: PRESTAGE fail — $GLUE missing execWait (libstubs execve won the link)" >&2
  exit 1
fi
if [[ -f "$GLUE" ]] && ! grep -qE 'slicc_spawn_capture|posix_spawn' "$GLUE"; then
  echo "homescoop: PRESTAGE fail — $GLUE missing spawn glue (posix_spawn not linked)" >&2
  exit 1
fi
echo "  PRESTAGE: $BIN_NAME glue has execWait (slicc execve linked)"

homescoop_stage_license "$SRC_DIR"/COPYING "$SRC_DIR"/LICENSE "$SRC_DIR"/COPYING.LIB
echo "== $NAME: staged → $HOMESCOOP_PKG/package"
