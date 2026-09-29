#!/usr/bin/env bash
# tls-engine build.sh — Mbed TLS (static, emcmake) + src/slicc_tls_engine.c
# → package/dist/slicc-tls-engine.mjs + .wasm. Needs emcc/emcmake, cmake,
# curl and shasum on PATH. WORK: scratch dir (default: ./.work).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${HOMESCOOP_ROOT:-$(cd "$HERE/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# Nest under shared HOMESCOOP_WORK so curl's mbedtls install (different
# CFLAGS) is not reused; fall back to package-local .work for standalone runs.
_SAVED_WORK="${WORK:-}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe tls-engine
if [[ -n "$_SAVED_WORK" ]]; then
  WORK="$_SAVED_WORK/tls-engine"
else
  WORK="$HERE/.work"
fi
SRC="$WORK/mbedtls-$VERSION"
BUILD="$WORK/mbedtls-build"
PREFIX="$WORK/mbedtls-install"
OUT="$HERE/package/dist"
TB="$WORK/mbedtls-$VERSION.tar.bz2"
mkdir -p "$WORK" "$OUT"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"
[[ -d "$SRC" ]] || tar -xjf "$TB" -C "$WORK"

if [[ ! -f "$PREFIX/lib/libmbedtls.a" || -n "${FORCE:-}" ]]; then
  echo "== tls-engine: Mbed TLS $VERSION (static)"
  emcmake cmake -S "$SRC" -B "$BUILD" -DCMAKE_BUILD_TYPE=MinSizeRel \
    -DENABLE_TESTING=OFF -DENABLE_PROGRAMS=OFF -DUSE_SHARED_MBEDTLS_LIBRARY=OFF \
    -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    '-DCMAKE_C_FLAGS=-Oz -flto -DMBEDTLS_ENTROPY_HARDWARE_ALT -DMBEDTLS_NO_PLATFORM_ENTROPY'
  cmake --build "$BUILD" --parallel 8
  cmake --install "$BUILD"
fi

echo "== tls-engine: engine"
# shellcheck source=link-flags.sh
source "$HERE/link-flags.sh"
emcc -Oz -flto -DMBEDTLS_ENTROPY_HARDWARE_ALT -DMBEDTLS_NO_PLATFORM_ENTROPY \
  -I "$PREFIX/include" "$HERE/src/slicc_tls_engine.c" \
  "$PREFIX/lib/libmbedtls.a" "$PREFIX/lib/libmbedx509.a" "$PREFIX/lib/libmbedcrypto.a" \
  "$PREFIX/lib/libeverest.a" "$PREFIX/lib/libp256m.a" \
  "${ENGINE_LINK_FLAGS[@]}" -o "$OUT/slicc-tls-engine.mjs"
homescoop_stage_license "$SRC"/LICENSE
ls -la "$OUT"
