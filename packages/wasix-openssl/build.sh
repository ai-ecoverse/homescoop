#!/usr/bin/env bash
# wasix-openssl: OpenSSL built with the pinned wasixcc in two flavours,
# lib/ (static, non-PIC) and lib-pic/ (-fPIC), plus headers and pkg-config.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasix-openssl

TB="$WORK/openssl-$VERSION.tar.gz"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"

# The pinned toolchain in WORK: a developer's ~/.wasixcc is neither used nor touched.
eval "$(bash "$ROOT/scripts/install-wasixcc.sh" "$WORK/wasixcc")"
DEST="$HOMESCOOP_PKG/package"
rm -rf "$DEST/lib" "$DEST/lib-pic" "$DEST/include"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
unset CPPFLAGS LDFLAGS LIBRARY_PATH CPATH C_INCLUDE_PATH SDKROOT
export WASIXCC_RUN_WASM_OPT=no
# Reproducible libcrypto: util/mkbuildinf.pl writes OpenSSL_version(
# OPENSSL_BUILT_ON) from SOURCE_DATE_EPOCH, else the build time. Pinned to
# the OpenSSL 3.5.9 release (GitHub release openssl-3.5.9, published
# 2026-09-29T14:10:08Z); change it with the version.
export SOURCE_DATE_EPOCH=1790691008
BUILT_ON="built on: Tue Sep 29 14:10:08 2026 UTC"

build_flavour() {
  # wasixcc only builds PIC with wasm exceptions (python's ehpic tree: legacy).
  local dir=$1 pic=$2 eh=no picopt=no-pic
  if [[ "$pic" == yes ]]; then eh=legacy; picopt=; fi
  local bld="$WORK/openssl-$VERSION-$dir"
  rm -rf "$bld" && mkdir -p "$bld"
  tar xzf "$TB" -C "$bld" --strip-components=1
  echo "== wasix-openssl: Configure ($dir: WASIXCC_PIC=$pic, EH=$eh)"
  (
    cd "$bld"
    export WASIXCC_PIC=$pic WASIXCC_WASM_EXCEPTIONS=$eh
    export CC=wasixcc AR=wasixar RANLIB=wasixranlib NM=wasixnm
    export CFLAGS="-O2 -D_WASI_EMULATED_MMAN -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS -DUSE_TIMEGM -DOPENSSL_NO_SECURE_MEMORY -DOPENSSL_NO_DGRAM"
    # shellcheck disable=SC2086
    ./Configure linux-generic32 -static no-shared $picopt no-asm no-dso \
      no-tests no-apps no-docs no-afalgeng no-ui-console threads \
      --prefix=/ --libdir=lib --openssldir=/etc/ssl \
      -DUSE_TIMEGM -DOPENSSL_NO_SECURE_MEMORY -DOPENSSL_NO_DGRAM
    make build_generated >/dev/null
    make -j"$JOBS" libcrypto.a libssl.a >/dev/null
    wasixranlib libcrypto.a
    wasixranlib libssl.a
  )
  # The build date in libcrypto is the pinned one, not today's.
  local strs
  strs="$(strings "$bld/libcrypto.a")"
  grep -qF "$BUILT_ON" <<<"$strs" || {
    echo "homescoop wasix-openssl: libcrypto.a ($dir) lacks '$BUILT_ON'" >&2
    exit 1
  }
  mkdir -p "$DEST/$dir/pkgconfig"
  cp "$bld/libcrypto.a" "$bld/libssl.a" "$DEST/$dir/"
  local pcs="$DEST/$dir/pkgconfig" lib
  for lib in crypto ssl; do
    {
      echo "prefix=\${pcfiledir}/../.."
      echo "libdir=\${prefix}/$dir"
      echo "includedir=\${prefix}/include"
      echo
      echo "Name: OpenSSL-lib$lib"
      echo "Description: OpenSSL lib$lib (homescoop WASIX, $dir)"
      echo "Version: $VERSION"
      [[ $lib == ssl ]] && echo "Requires.private: libcrypto"
      echo "Libs: -L\${libdir} -l$lib"
      echo "Cflags: -I\${includedir}"
    } >"$pcs/lib$lib.pc"
  done
  printf 'prefix=${pcfiledir}/../..\n\nName: OpenSSL\nDescription: OpenSSL (homescoop WASIX, %s)\nVersion: %s\nRequires: libssl libcrypto\n' "$dir" "$VERSION" >"$pcs/openssl.pc"
  # Headers: public include/openssl plus the generated configuration headers.
  mkdir -p "$WORK/openssl-include-$dir"
  rm -rf "$WORK/openssl-include-$dir/openssl"
  cp -R "$bld/include/openssl" "$WORK/openssl-include-$dir/"
  echo "== wasix-openssl: $dir/libcrypto.a $(wc -c <"$DEST/$dir/libcrypto.a" | tr -d ' ') B, libssl.a $(wc -c <"$DEST/$dir/libssl.a" | tr -d ' ') B"
}
build_flavour lib no
build_flavour lib-pic yes

# One include/ for both flavours: the generated headers must agree.
if ! diff -r "$WORK/openssl-include-lib" "$WORK/openssl-include-lib-pic" >/dev/null; then
  echo "homescoop wasix-openssl: the two flavours generated different headers:" >&2
  diff -r "$WORK/openssl-include-lib" "$WORK/openssl-include-lib-pic" >&2 || true
  exit 1
fi
mkdir -p "$DEST/include"
cp -R "$WORK/openssl-include-lib/openssl" "$DEST/include/"

homescoop_stage_licenses "$WORK/openssl-$VERSION-lib/LICENSE.txt"
homescoop_notices_begin "libcrypto.a and libssl.a (both flavours) are OpenSSL itself (LICENSE, Apache-2.0); they are compiled against and meant to be linked with the following."
WLIBC=https://raw.githubusercontent.com/wasix-org/wasix-libc/v2025-09-02.1
homescoop_notice "wasix-libc headers (@ai-ecoverse/wasix-sysroot 2025.9.30-17; files from tag v2025-09-02.1)" \
  "$WLIBC/LICENSE" da1128117561950db9e04201ce9ac3f0bd9e3baf852289211608b73098d51ac0 \
  "$WLIBC/LICENSE-MIT" 23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3 \
  "$WLIBC/libc-top-half/musl/COPYRIGHT" f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af
homescoop_assert_no_package_links "$DEST"
echo "== wasix-openssl: staged $VERSION"
