#!/usr/bin/env bash
# wasix-libsodium: libsodium built with the pinned wasixcc in two flavours,
# lib/ (static, non-PIC) and lib-pic/ (-fPIC), plus headers and pkg-config.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasix-libsodium
field() { node "$ROOT/scripts/read-recipe.mjs" wasix-libsodium --field "$1"; }

TB="$WORK/libsodium-$VERSION.tar.gz"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"

# wasix-sysroot -40, the one wasix-python 3.15.0-8 is built on. Literal
# values, so cert-review's input rule can read them; they must match the
# recipe's toolchain.wasix_sysroot, which wasix-lib-cert.mjs installs for the cert.
export HOMESCOOP_WASIX_SYSROOT_VERSION=2025.9.30-40
export HOMESCOOP_WASIX_SYSROOT_SHA=9960846c81c78d40a8dfdd58009e66d5ad671a6469947517661b486a4a3d3336
[[ "$HOMESCOOP_WASIX_SYSROOT_VERSION" == "$(field toolchain.wasix_sysroot)" && "$HOMESCOOP_WASIX_SYSROOT_SHA" == "$(field toolchain.wasix_sysroot_sha256)" ]] \
  || { echo "homescoop wasix-libsodium: build.sh's wasix-sysroot pin isn't recipe.yaml's toolchain.wasix_sysroot" >&2; exit 1; }
# The pinned toolchain in WORK: a developer's ~/.wasixcc is neither used nor touched.
eval "$(bash "$ROOT/scripts/install-wasixcc.sh" "$WORK/wasixcc-$HOMESCOOP_WASIX_SYSROOT_VERSION")"
test "$(node -p "require(process.argv[1]).version" "$WASIXCC_SYSROOT_PREFIX/package.json")" = "$HOMESCOOP_WASIX_SYSROOT_VERSION"
DEST="$HOMESCOOP_PKG/package"
rm -rf "$DEST/lib" "$DEST/lib-pic" "$DEST/include"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
unset CPPFLAGS LDFLAGS LIBS LIBRARY_PATH CPATH C_INCLUDE_PATH SDKROOT WASIXCC_MODULE_KIND PKG_CONFIG_PATH PKG_CONFIG_LIBDIR || true
export WASIXCC_RUN_WASM_OPT=no
# A fixed build root: objects (assert's __FILE__) carry no per-run path.
B="$(cd /tmp && pwd -P)/homescoop-wasix-libsodium-$VERSION"
rm -rf "$B" && mkdir -p "$B"

build_flavour() {
  # wasixcc only builds PIC with wasm exceptions (python's ehpic tree:
  # legacy EH); libsodium has no setjmp/C++, so the objects carry no EH code.
  local dir=$1 pic=$2 eh=no
  [[ "$pic" == yes ]] && eh=legacy
  local bld="$B/$dir"
  rm -rf "$bld" && mkdir -p "$bld"
  tar xzf "$TB" -C "$bld" --strip-components=1
  # libsodium-argon2-wasm32-fblamka.patch: upstream's fix of the wasm32
  # SIMD Argon2 (wrong hashes with simd128, which wasixcc always enables).
  homescoop_apply_patches "$bld"
  echo "== wasix-libsodium: configure ($dir: WASIXCC_PIC=$pic, EH=$eh)"
  (
    cd "$bld"
    export WASIXCC_PIC=$pic WASIXCC_WASM_EXCEPTIONS=$eh
    export CC=wasixcc AR=wasixar RANLIB=wasixranlib NM=wasixnm
    # -O3 as upstream's dist-build/wasm32-wasi.sh; no -DED25519_NONDETERMINISTIC
    # (that script's default), so Ed25519 signatures stay RFC 8032's.
    export CFLAGS="-O3 -ffile-prefix-map=$bld=libsodium-$VERSION"
    ./configure --host=wasm32-wasi --prefix=/ --disable-shared --enable-static \
      --disable-asm --disable-ssp --disable-pie --disable-dependency-tracking >"$B/configure-$dir.log" 2>&1 \
      || { tail -60 "$B/configure-$dir.log" >&2; tail -80 config.log >&2; exit 1; }
    # What the WASI branch of configure must find: arc4random_buf (WASI
    # random_get in wasix-libc) and pthreads; and no minimal build.
    for d in HAVE_ARC4RANDOM_BUF HAVE_PTHREAD HAVE_C11_MEMORY_FENCES; do
      grep -q -- "-D$d=1" src/libsodium/Makefile \
        || { echo "homescoop wasix-libsodium: configure ($dir) did not define $d" >&2; exit 1; }
    done
    grep -q '^#define SODIUM_LIBRARY_MINIMAL' src/libsodium/include/sodium/version.h \
      && { echo "homescoop wasix-libsodium: configure ($dir) made a minimal build" >&2; exit 1; }
    make -j"$JOBS" -C src/libsodium >"$B/make-$dir.log" 2>&1 || { tail -60 "$B/make-$dir.log" >&2; exit 1; }
    make -C src/libsodium install DESTDIR="$bld/inst" >"$B/install-$dir.log" 2>&1 || { tail -40 "$B/install-$dir.log" >&2; exit 1; }
  )
  local a="$bld/inst/lib/libsodium.a"
  test -s "$a"
  # The objects WASI must not need: nothing opens /dev/urandom, and the
  # system RNG is libc's arc4random_buf.
  local syms strs
  syms="$(wasixnm "$a" 2>/dev/null)"
  strs="$(strings "$a")"
  if grep -q '/dev/urandom' <<<"$strs"; then
    echo "homescoop wasix-libsodium: $dir/libsodium.a mentions /dev/urandom (sysrandom took the device path)" >&2
    exit 1
  fi
  grep -q ' U arc4random_buf$' <<<"$syms" \
    || { echo "homescoop wasix-libsodium: $dir/libsodium.a does not call arc4random_buf" >&2; exit 1; }
  grep -q ' T argon2_fill_segment_wasm32$' <<<"$syms" \
    || { echo "homescoop wasix-libsodium: $dir/libsodium.a has no wasm32 SIMD Argon2 (simd128 off?)" >&2; exit 1; }
  if grep -qF "$B" <<<"$strs"; then
    echo "homescoop wasix-libsodium: $dir/libsodium.a embeds the build path $B" >&2
    exit 1
  fi
  mkdir -p "$DEST/$dir/pkgconfig"
  cp "$a" "$DEST/$dir/libsodium.a"
  # Paths relative to the .pc file: <pkg>/<dir>/pkgconfig/libsodium.pc.
  cat >"$DEST/$dir/pkgconfig/libsodium.pc" <<PC
prefix=\${pcfiledir}/../..
libdir=\${prefix}/$dir
includedir=\${prefix}/include

Name: libsodium
Version: $VERSION
Description: A modern and easy-to-use crypto library (homescoop WASIX, $dir)

Libs: -L\${libdir} -lsodium
Libs.private: -pthread
Cflags: -I\${includedir}
PC
  rm -rf "$B/include-$dir"
  cp -R "$bld/inst/include" "$B/include-$dir"
  echo "== wasix-libsodium: $dir/libsodium.a ($(wc -c <"$DEST/$dir/libsodium.a" | tr -d ' ') bytes)"
}
build_flavour lib no
build_flavour lib-pic yes

# One include/ for both flavours: the generated version.h must agree.
if ! diff -r "$B/include-lib" "$B/include-lib-pic" >/dev/null; then
  echo "homescoop wasix-libsodium: the two flavours installed different headers:" >&2
  diff -r "$B/include-lib" "$B/include-lib-pic" >&2 || true
  exit 1
fi
cp -R "$B/include-lib" "$DEST/include"
grep -q "^#define SODIUM_VERSION_STRING \"$VERSION\"$" "$DEST/include/sodium/version.h" \
  || { echo "homescoop wasix-libsodium: include/sodium/version.h is not $VERSION" >&2; exit 1; }

homescoop_stage_licenses "$B/lib/LICENSE"
homescoop_notices_begin "libsodium.a (both flavours) is libsodium itself (LICENSE, ISC); it is compiled against and meant to be linked with the following."
WLIBC=https://raw.githubusercontent.com/wasix-org/wasix-libc/v2026-07-03.1
homescoop_notice "wasix-libc headers (@ai-ecoverse/wasix-sysroot $(node -p "require(process.argv[1]).version" "$WASIXCC_SYSROOT_PREFIX/package.json"); files from tag v2026-07-03.1)" \
  "$WLIBC/LICENSE" da1128117561950db9e04201ce9ac3f0bd9e3baf852289211608b73098d51ac0 \
  "$WLIBC/LICENSE-MIT" 23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3 \
  "$WLIBC/libc-top-half/musl/COPYRIGHT" f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af
homescoop_assert_no_package_links "$DEST"
rm -rf "$B"
echo "== wasix-libsodium: staged $VERSION"
