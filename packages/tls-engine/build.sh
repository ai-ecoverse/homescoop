#!/usr/bin/env bash
# tls-engine build.sh — Mbed TLS 4 with its bundled TF-PSA-Crypto (static,
# emcmake) + src/slicc_tls_engine.c → package/dist/slicc-tls-engine.mjs +
# .wasm. Needs emcc/emcmake, cmake, python3, curl and shasum on PATH. WORK:
# scratch dir (default: ./.work).
#
# src/tls_engine_crypto_config.h is TF-PSA-Crypto's user config (the entropy
# source: crypto.getRandomValues). The library and the engine must see the
# same configuration, so both get it.
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

CRYPTO_CONFIG="$HERE/src/tls_engine_crypto_config.h"
if [[ ! -f "$PREFIX/lib/libtfpsacrypto.a" || -n "${FORCE:-}" ]]; then
  echo "== tls-engine: Mbed TLS $VERSION (static)"
  emcmake cmake -S "$SRC" -B "$BUILD" -DCMAKE_BUILD_TYPE=MinSizeRel \
    -DENABLE_TESTING=OFF -DENABLE_PROGRAMS=OFF -DUSE_SHARED_MBEDTLS_LIBRARY=OFF \
    -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DTF_PSA_CRYPTO_USER_CONFIG_FILE="$CRYPTO_CONFIG" \
    '-DCMAKE_C_FLAGS=-Oz -flto'
  cmake --build "$BUILD" --parallel 8
  cmake --install "$BUILD"
fi

echo "== tls-engine: engine"
# shellcheck source=link-flags.sh
source "$HERE/link-flags.sh"
# libtfpsacrypto.a is the crypto (libmbedcrypto.a is a copy under the 3.x
# name). The p256-m and Everest drivers, off by default as in 3.6, are built
# into it: no libp256m.a or libeverest.a any more.
emcc -Oz -flto "-DTF_PSA_CRYPTO_USER_CONFIG_FILE=\"$CRYPTO_CONFIG\"" \
  -I "$PREFIX/include" "$HERE/src/slicc_tls_engine.c" \
  "$PREFIX/lib/libmbedtls.a" "$PREFIX/lib/libmbedx509.a" "$PREFIX/lib/libtfpsacrypto.a" \
  "${ENGINE_LINK_FLAGS[@]}" -o "$OUT/slicc-tls-engine.mjs"
homescoop_stage_license "$SRC"/LICENSE
ls -la "$OUT"
