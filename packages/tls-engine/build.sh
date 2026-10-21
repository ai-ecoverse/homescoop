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
# Per version: a CMake cache names its source tree, and an install over
# another version's would keep that version's headers (3.6's ctr_drbg.h).
BUILD="$WORK/mbedtls-$VERSION-build"
PREFIX="$WORK/mbedtls-$VERSION-install"
OUT="$HERE/package/dist"
TB="$WORK/mbedtls-$VERSION.tar.bz2"
mkdir -p "$WORK" "$OUT"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"
[[ -d "$SRC" ]] || tar -xjf "$TB" -C "$WORK"
homescoop_apply_patches "$SRC"

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
# Mbed TLS's and TF-PSA-Crypto's (the crypto in the wasm): the same terms,
# each naming its own files.
homescoop_stage_licenses "$SRC"/LICENSE "$SRC"/tf-psa-crypto/LICENSE

echo "== tls-engine: roots.der"
# Mozilla's root store from curl's dated, sha256-pinned PEM bundle, as
# concatenated DER in the bundle's order (byte-stable). It is MPL-2.0 data:
# THIRD-PARTY-NOTICES.md names it, with that licence's text.
homescoop_load_recipe tls-engine --source roots
homescoop_load_recipe tls-engine --source mpl
ROOTS_PEM="$WORK/cacert-$ROOTS_VERSION.pem"
homescoop_fetch "$ROOTS_URL" "$ROOTS_SHA" "$ROOTS_PEM"
ROOTS_COUNT="$(python3 - "$ROOTS_PEM" "$OUT/roots.der" <<'PY'
import base64, re, sys
pem = open(sys.argv[1], encoding="utf-8").read()
blocks = re.findall(r"-----BEGIN CERTIFICATE-----\n(.*?)-----END CERTIFICATE-----", pem, re.S)
with open(sys.argv[2], "wb") as out:
    for block in blocks:
        out.write(base64.b64decode("".join(block.split())))
print(len(blocks))
PY
)"
(( ROOTS_COUNT > 100 )) || { echo "tls-engine: only $ROOTS_COUNT roots in $ROOTS_PEM" >&2; exit 1; }
homescoop_notices_begin "dist/roots.der (the default root store a client session may load) is derived from:"
printf '\n## Mozilla CA certificate store, as curl publishes it (cacert-%s.pem)\n\n%s\n' \
  "$ROOTS_VERSION" "Source: $ROOTS_URL (sha256 $ROOTS_SHA). The $ROOTS_COUNT PEM certificates are decoded to DER and concatenated in the bundle's order, unmodified otherwise. Licence: MPL-2.0, from Mozilla's NSS (certdata.txt); its text follows." \
  >>"$HOMESCOOP_NOTICES"
homescoop_notice "Mozilla Public License 2.0" "$MPL_URL" "$MPL_SHA"
node -e 'const r = require(process.argv[1]).slicc.tls.roots; if (r.date !== process.argv[2] || r.sha256 !== process.argv[3]) { console.error(`package.json slicc.tls.roots (${r.date}) does not match the recipe (${process.argv[2]})`); process.exit(1); }' "$HERE/package/package.json" "$ROOTS_VERSION" "$ROOTS_SHA"
echo "== tls-engine: $ROOTS_COUNT roots from cacert-$ROOTS_VERSION.pem"
ls -la "$OUT"
