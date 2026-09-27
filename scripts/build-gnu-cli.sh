#!/usr/bin/env bash
# Shared host body for GNU userland CLI tools (coreutils, sed, grep, gawk).
# Port of slicc-emscripten/build-wasm-gnu.sh.
# Usage: sourced from packages/<name>/build.sh after setting NAME VERSION SRC_URL SRC_SHA
#   or: bash scripts/build-gnu-cli.sh <name>
set -euo pipefail

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  NAME="${1:?usage: build-gnu-cli.sh <coreutils|sed|grep|gawk>}"
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  export HOMESCOOP_ROOT="$ROOT"
  # shellcheck source=./build-common.sh
  source "$ROOT/scripts/build-common.sh"
  HOMESCOOP_PKG="$ROOT/packages/$NAME"
  case "$NAME" in
    coreutils) VERSION=9.7; SRC_URL=https://ftp.gnu.org/gnu/coreutils/coreutils-9.7.tar.xz
      SRC_SHA=e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf ;;
    sed) VERSION=4.9; SRC_URL=https://ftp.gnu.org/gnu/sed/sed-4.9.tar.xz
      SRC_SHA=6e226b732e1cd739464ad6862bd1a1aba42d7982922da7a53519631d24975181 ;;
    grep) VERSION=3.12; SRC_URL=https://ftp.gnu.org/gnu/grep/grep-3.12.tar.xz
      SRC_SHA=2649b27c0e90e632eadcd757be06c6e9a4f48d941de51e7c0f83ff76408a07b9 ;;
    gawk) VERSION=5.3.2; SRC_URL=https://ftp.gnu.org/gnu/gawk/gawk-5.3.2.tar.xz
      SRC_SHA=f8c3486509de705192138b00ef2c00bbbdd0e84c30d5c07d23fc73a9dc4cc9cc ;;
    *) echo "unknown gnu cli: $NAME" >&2; exit 2 ;;
  esac
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

# Apply patches once (marker file)
for p in "$ROOT"/patches/"$NAME-$VERSION"-*.patch; do
  [[ -f "$p" ]] || continue
  marker="$SRC_DIR/.homescoop-patched-$(basename "$p")"
  if [[ ! -f "$marker" ]]; then
    echo "== patch $(basename "$p")"
    patch -d "$SRC_DIR" -p1 < "$p"
    touch "$marker"
  fi
done

SLICC_A="$WORK/libslicc-spawn.a"
homescoop_slicc_archive "$SLICC_A" spawn

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1048576 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
# -u pulls signal exports out of the archive (wasm realm calls them from JS).
CLI_LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports) $SLICC_A"

EXTRA_CFG=()
case "$NAME" in
  coreutils) EXTRA_CFG=(--enable-single-binary=symlinks --enable-no-install-program=stdbuf) ;;
  gawk) EXTRA_CFG=(--disable-extensions --disable-mpfr) ;;
esac

# Emscripten configure mode tolerates undefined symbols; force honest answers.
export ac_cv_func_splice=no ac_cv_func_sethostname=yes gl_cv_func_nanosleep=yes

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
      --disable-nls "${EXTRA_CFG[@]}"
    homescoop_fix_darwin_ar Makefile
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
      LDFLAGS="$CLI_LDFLAGS"
  )
fi

# Locate binary (coreutils lives in src/)
STAGE_DIR="$SRC_DIR"
if [[ -f "$SRC_DIR/src/$BIN_NAME" || -f "$SRC_DIR/src/$BIN_NAME.js" ]]; then
  STAGE_DIR="$SRC_DIR/src"
fi
test -f "$STAGE_DIR/$BIN_NAME" || test -f "$STAGE_DIR/$BIN_NAME.js"
homescoop_stage_cli "$STAGE_DIR" "$BIN_NAME"
echo "== $NAME: staged → $HOMESCOOP_PKG/package"
