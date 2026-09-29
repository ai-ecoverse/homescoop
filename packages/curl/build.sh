#!/usr/bin/env bash
# curl + libcurl (Mbed TLS, zlib, HTTP/1.1) for the slicc wasm realm.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe curl
homescoop_load_recipe curl --source mbedtls

CURL_VER="$VERSION"
CURL_TB="$WORK/curl-${CURL_VER}.tar.xz"
CURL_SRC="$WORK/curl-${CURL_VER}"
CURL_OUT="$WORK/curl-build"

MBED_VER="$MBEDTLS_VER"
MBED_TB="$WORK/mbedtls-${MBED_VER}.tar.bz2"
MBED_SRC="$WORK/mbedtls-${MBED_VER}"
MBED_OUT="$WORK/mbedtls-build"
MBED_PREFIX="$WORK/mbedtls-install"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$CURL_TB"
homescoop_fetch "$MBEDTLS_URL" "$MBEDTLS_SHA" "$MBED_TB"
if [[ -n "${FORCE:-}" ]]; then
  rm -rf "$CURL_SRC" "$CURL_OUT" "$MBED_SRC" "$MBED_OUT" "$MBED_PREFIX"
fi
homescoop_extract "$CURL_TB" "$CURL_SRC"
homescoop_extract "$MBED_TB" "$MBED_SRC"

# --- Mbed TLS (static, hardware entropy via webcrypto-entropy.c) ---
if [[ ! -f "$MBED_PREFIX/lib/libmbedtls.a" || -n "${FORCE:-}" ]]; then
  echo "== curl: build Mbed TLS ${MBED_VER}"
  rm -rf "$MBED_OUT" "$MBED_PREFIX"
  mkdir -p "$MBED_OUT" "$MBED_PREFIX"
  (
    emcmake cmake -S "$MBED_SRC" -B "$MBED_OUT" \
      -DENABLE_TESTING=OFF -DENABLE_PROGRAMS=OFF \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX="$MBED_PREFIX" \
      -DCMAKE_C_FLAGS="-O2 -DMBEDTLS_ENTROPY_HARDWARE_ALT -DMBEDTLS_NO_PLATFORM_ENTROPY"
    cmake --build "$MBED_OUT" --parallel "${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
    cmake --install "$MBED_OUT"
  )
fi
test -f "$MBED_PREFIX/lib/libmbedtls.a"
test -f "$MBED_PREFIX/lib/libmbedx509.a"
test -f "$MBED_PREFIX/lib/libmbedcrypto.a"

# everest / p256m land under lib/ after install (or 3rdparty build tree)
for alt in \
  "$MBED_PREFIX/lib/libeverest.a" \
  "$MBED_OUT/3rdparty/everest/libeverest.a"
do
  [[ -f "$alt" ]] && { EVEREST_A="$alt"; break; }
done
for alt in \
  "$MBED_PREFIX/lib/libp256m.a" \
  "$MBED_OUT/3rdparty/p256-m/libp256m.a"
do
  [[ -f "$alt" ]] && { P256M_A="$alt"; break; }
done
: "${EVEREST_A:?libeverest.a missing}"
: "${P256M_A:?libp256m.a missing}"

ENTROPY_O="$WORK/webcrypto-entropy.o"
emcc -O2 -c "$ROOT/shims/slicc/webcrypto-entropy.c" -o "$ENTROPY_O"

SLICC_A="$WORK/libslicc-net.a"
homescoop_slicc_archive "$SLICC_A" net

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1048576 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain -lnodefs.js"
CLI_LDFLAGS="$(homescoop_em_cli_ldflags)"
LINK_FLAGS="$ENTROPY_O $EVEREST_A $P256M_A $(homescoop_slicc_link_archive "$SLICC_A") $CLI_LDFLAGS"

ZLIB_A="$PREFIX/lib/libz.a"
test -f "$ZLIB_A" || { echo "missing $ZLIB_A (host-run should unpack wasm-zlib)" >&2; exit 1; }

configure_args=(
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_C_FLAGS=-O2
  -DBUILD_CURL_EXE=ON
  -DBUILD_SHARED_LIBS=OFF
  -DBUILD_STATIC_LIBS=ON
  -DCURL_DISABLE_INSTALL=OFF
  -DCMAKE_INSTALL_PREFIX="$WORK/curl-install"
  -DBUILD_TESTING=OFF
  -DBUILD_LIBCURL_DOCS=OFF
  -DBUILD_MISC_DOCS=OFF
  -DENABLE_CURL_MANUAL=OFF
  -DCURL_USE_OPENSSL=OFF
  -DCURL_USE_MBEDTLS=ON
  -DCURL_ENABLE_SSL=ON
  -DCURL_USE_PKGCONFIG=OFF
  -DCURL_USE_LIBPSL=OFF
  -DUSE_NGHTTP2=OFF
  -DCURL_ZLIB=ON
  -DZLIB_INCLUDE_DIR="$PREFIX/include"
  -DZLIB_LIBRARY="$ZLIB_A"
  -DCURL_BROTLI=OFF
  -DCURL_ZSTD=OFF
  -DUSE_LIBIDN2=OFF
  -DCURL_USE_LIBSSH2=OFF
  -DENABLE_THREADED_RESOLVER=OFF
  -DENABLE_IPV6=OFF
  -DCURL_DISABLE_LDAP=ON
  -DCURL_DISABLE_LDAPS=ON
  -DCURL_DISABLE_RTSP=ON
  -DCURL_DISABLE_TELNET=ON
  -DCURL_DISABLE_TFTP=ON
  -DCURL_DISABLE_FTP=ON
  -DCURL_DISABLE_IMAP=ON
  -DCURL_DISABLE_POP3=ON
  -DCURL_DISABLE_SMTP=ON
  -DCURL_DISABLE_DICT=ON
  -DCURL_DISABLE_GOPHER=ON
  -DCURL_DISABLE_MQTT=ON
  -DCURL_DISABLE_SMB=ON
  -DMBEDTLS_USE_STATIC_LIBS=ON
  -DMBEDTLS_INCLUDE_DIR="$MBED_PREFIX/include"
  -DMBEDTLS_LIBRARY="$MBED_PREFIX/lib/libmbedtls.a"
  -DMBEDX509_LIBRARY="$MBED_PREFIX/lib/libmbedx509.a"
  -DMBEDCRYPTO_LIBRARY="$MBED_PREFIX/lib/libmbedcrypto.a"
)

if [[ ! -f "$CURL_OUT/src/curl.wasm" || ! -f "$CURL_OUT/lib/libcurl.a" || -n "${FORCE:-}" ]]; then
  echo "== curl: emcmake configure (probe pass, then link flags)"
  rm -rf "$CURL_OUT"
  mkdir -p "$CURL_OUT"
  # curl's sizeof probes break with realm link flags — configure twice.
  emcmake cmake -S "$CURL_SRC" -B "$CURL_OUT" "${configure_args[@]}"
  emcmake cmake -S "$CURL_SRC" -B "$CURL_OUT" "${configure_args[@]}" \
    "-DCMAKE_EXE_LINKER_FLAGS=$LINK_FLAGS"
  echo "== curl: build curl + libcurl"
  cmake --build "$CURL_OUT" --parallel "${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
    --target curl libcurl_static
fi

# Locate outputs (Release vs no-config; libcurl.a vs libcurl.a naming)
CURL_BIN=""
for c in "$CURL_OUT/src/curl" "$CURL_OUT/src/curl.js"; do
  [[ -f "$c" ]] && { CURL_BIN="$c"; break; }
done
: "${CURL_BIN:?curl binary missing}"
if [[ -f "$CURL_OUT/src/curl.js" && ! -f "$CURL_OUT/src/curl" ]]; then
  mv "$CURL_OUT/src/curl.js" "$CURL_OUT/src/curl"
  CURL_BIN="$CURL_OUT/src/curl"
fi
test -f "$CURL_OUT/src/curl.wasm" || test -f "$CURL_BIN"

LIBCURL_A=""
for a in "$CURL_OUT/lib/libcurl.a" "$CURL_OUT/libcurl.a" "$CURL_OUT/lib/libcurl.a"; do
  [[ -f "$a" ]] && { LIBCURL_A="$a"; break; }
done
# cmake may put it under lib/
if [[ -z "$LIBCURL_A" ]]; then
  LIBCURL_A="$(find "$CURL_OUT" -name 'libcurl*.a' ! -name '*shared*' | head -1)"
fi
: "${LIBCURL_A:?libcurl.a missing}"

echo "== curl: stage CLI + libs + headers"
homescoop_stage_cli "$CURL_OUT/src" curl
homescoop_stage_lib "$LIBCURL_A" libcurl.a
homescoop_stage_lib "$MBED_PREFIX/lib/libmbedtls.a" libmbedtls.a
homescoop_stage_lib "$MBED_PREFIX/lib/libmbedx509.a" libmbedx509.a
homescoop_stage_lib "$MBED_PREFIX/lib/libmbedcrypto.a" libmbedcrypto.a
homescoop_stage_lib "$EVEREST_A" libeverest.a
homescoop_stage_lib "$P256M_A" libp256m.a
cp "$ENTROPY_O" "$HOMESCOOP_PKG/package/lib/webcrypto-entropy.o"
cp "$ENTROPY_O" "$PREFIX/lib/webcrypto-entropy.o"

# Public curl headers
mkdir -p "$HOMESCOOP_PKG/package/include/curl" "$PREFIX/include/curl"
cp "$CURL_SRC/include/curl/"*.h "$HOMESCOOP_PKG/package/include/curl/"
cp "$CURL_SRC/include/curl/"*.h "$PREFIX/include/curl/"

homescoop_write_pc curl "$CURL_VER" \
  "-lcurl -lmbedtls -lmbedx509 -lmbedcrypto -leverest -lp256m \${libdir}/webcrypto-entropy.o -lz" \
  "" \
  ""

homescoop_stage_license "$CURL_SRC"/COPYING "$CURL_SRC"/LICENSE
echo "== curl: staged → $HOMESCOOP_PKG/package"
