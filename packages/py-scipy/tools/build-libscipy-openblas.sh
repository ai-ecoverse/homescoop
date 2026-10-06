#!/usr/bin/env bash
# Build scipy/.libs/libscipy_openblas.so — one shared OpenBLAS side module
# (PIC / dylink.0) from the static wasix OpenBLAS archive.
set -euo pipefail

PREFIX_OB="${WASIX_OPENBLAS_PREFIX:-/tmp/wasix-openblas-prefix}"
WASIXCC_BIN="${WASIXCC_BIN:-/tmp/wasix-python-build/wasixcc-prefix/bin}"
OUT="${1:?usage: build-libscipy-openblas.sh <outdir>}"
# Use real wasixcc (not scipy wrappers that rewrite -lopenblas).
WASIXCC_REAL="${WASIXCC_REAL:-$WASIXCC_BIN/wasixcc}"

test -f "$PREFIX_OB/lib/libopenblas.a"
test -x "$WASIXCC_REAL"

mkdir -p "$OUT"
export PATH="$WASIXCC_BIN:$PATH"
export WASIXCC_RUN_WASM_OPT=no
export WASIXCC_WASM_EXCEPTIONS=exnref
export WASIXCC_PIC=yes
export WASIXCC_MODULE_KIND=shared-library
export WASIXCC_INCLUDE_CPP_SYMBOLS=yes

# Side module: PIC shared, export OpenBLAS symbols, leave xerbla unresolved
# (provided by the loading SciPy extension, as with the static link).
"$WASIXCC_REAL" \
  -shared -fPIC -fvisibility=default \
  -nostdlib \
  -Wl,--allow-undefined \
  -Wl,--export-dynamic \
  -Wl,--soname=libscipy_openblas.so \
  -Wl,--whole-archive "$PREFIX_OB/lib/libopenblas.a" -Wl,--no-whole-archive \
  -o "$OUT/libscipy_openblas.so"

ls -lh "$OUT/libscipy_openblas.so"
# Sanity: key BLAS/LAPACK symbols exported
wasixnm "$OUT/libscipy_openblas.so" 2>/dev/null | grep -E ' T (cblas_dgemm|dgemm_|dgesv_|dgesvd_)$' | head || \
  llvm-nm "$OUT/libscipy_openblas.so" 2>/dev/null | grep -E ' T (cblas_dgemm|dgemm_|dgesv_|dgesvd_)$' | head || \
  strings -a "$OUT/libscipy_openblas.so" | grep -E '^(cblas_dgemm|dgemm_|dgesv_)$' | head
echo "OK $OUT/libscipy_openblas.so"
