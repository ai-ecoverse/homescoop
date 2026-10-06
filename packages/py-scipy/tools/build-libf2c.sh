#!/usr/bin/env bash
# Build static WASIX libf2c.a from CLAPACK F2CLIBS (Pyodide patches).
set -euo pipefail

ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}"
PKG="$ROOT/packages/py-scipy"
WORK="${WASIX_SCIPY_WORK:-/tmp/wasix-scipy-build}"
CLAPACK="${WASIX_CLAPACK:-$WORK/CLAPACK-3.2.1}"
PREFIX="${WASIX_LIBF2C_PREFIX:-$WORK/libf2c-prefix}"
WASIXCC_BIN="${WASIXCC_BIN:-/tmp/wasix-python-build/wasixcc-prefix/bin}"

test -d "$CLAPACK/F2CLIBS/libf2c"
test -x "$WASIXCC_BIN/wasixcc"

export PATH="$WASIXCC_BIN:$PATH"
export WASIXCC_RUN_WASM_OPT=no
export WASIXCC_WASM_EXCEPTIONS=exnref
export WASIXCC_PIC=yes
# Object archive: do not set MODULE_KIND=shared-library (openblas pattern)
unset WASIXCC_MODULE_KIND WASIXCC_INCLUDE_CPP_SYMBOLS || true
export CC=wasixcc
export AR=wasixar
export RANLIB=wasixranlib

echo "== libf2c: apply patches =="
cd "$CLAPACK"
for p in "$PKG/patches/libf2c"/000*.patch; do
  marker=".homescoop-libf2c-$(basename "$p")"
  if [[ -f "$marker" ]]; then
    echo "skip $(basename "$p")"
    continue
  fi
  echo "patch $(basename "$p")"
  patch -p1 --forward --batch < "$p"
  touch "$marker"
done

cp -f "$PKG/patches/libf2c/make.inc" "$CLAPACK/make.inc"

echo "== libf2c: build =="
cd "$CLAPACK/F2CLIBS/libf2c"
# Pyodide patch 0001 makes arith.h via node+emscripten; for wasix generate
# with host cc (-DNO_FPINIT) before the wasm compile.
rm -f arith.h a.out a.out.js a.out.wasm arithchk
cc -DNO_FPINIT -O0 -o arithchk arithchk.c -lm
./arithchk > arith.h
rm -f arithchk
test -s arith.h
echo "arith.h: $(wc -c < arith.h) bytes"
cp -f signal1.h0 signal1.h
cp -f sysdep1.h0 sysdep1.h

# Neutralize emscripten arith.h rule from patch 0001 (node a.out.js)
# Keep existing broken rule; we already have arith.h and touch it as prerequisite.
find . -name '*.o' -delete 2>/dev/null || true
rm -f libf2c.a

make -j"$(sysctl -n hw.ncpu 2>/dev/null || echo 4)" \
  CC="$CC" CFLAGS="-O2 -fPIC -I. -DNO_BLAS_WRAP -DSkip_f2c_Undefs" \
  AR="$AR" ARCH="$AR" ARCHFLAGS=cr RANLIB="$RANLIB" \
  libf2c.a

mkdir -p "$PREFIX/lib" "$PREFIX/include"
cp -f libf2c.a "$PREFIX/lib/libf2c.a"
# Prefer hoodmane/f2c.h if present (matches f2c -R output)
if [[ -f "$WORK/f2c/f2c.h" ]]; then
  cp -f "$WORK/f2c/f2c.h" "$PREFIX/include/f2c.h"
elif [[ -f f2c.h ]]; then
  cp -f f2c.h "$PREFIX/include/f2c.h"
fi
echo "== libf2c: staged $(du -h "$PREFIX/lib/libf2c.a" | awk '{print $1}') → $PREFIX"
