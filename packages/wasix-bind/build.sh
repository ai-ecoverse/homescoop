#!/usr/bin/env bash
# Cross-build BIND 9's dig, host and nslookup for slicc WASIX via wasixcc.
#
# - BIND's network layer is libuv with threads: WASIX (pthreads, sockets,
#   poll), not Emscripten. libuv is wasix-org's WASIX port, built here.
# - userspace-rcu and BIND are built static (no shared linking on WASIX);
#   wasix-openssl comes from its published dev package, by pkg-config.
# - Only lib/{isc,dns,isccc,ns,isccfg} and bin/dig are built.
set -euo pipefail

HOMESCOOP_ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=/dev/null
source "$HOMESCOOP_ROOT/scripts/build-common.sh"
homescoop_load_recipe wasix-bind
homescoop_load_recipe wasix-bind --source libuv
homescoop_load_recipe wasix-bind --source urcu
homescoop_load_recipe wasix-bind --source wasix_openssl

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
# The packaging revision is the committed package.json's (ruby/gnupg rule).
PKG_VER="$(node -p "require('$DEST/package.json').version")"
[[ "$PKG_VER" == "$VERSION-"* ]] || { echo "homescoop wasix-bind: package.json version $PKG_VER is not $VERSION-N" >&2; exit 1; }
WORK="${WASIX_BIND_WORK:-$PKG/.work}"
SRCS="$WORK/src"
BUILD="$WORK/build"
DEPS="$WORK/deps"
PREFIX="$WORK/prefix"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
OPENSSL_PREFIX="$DEPS/wasix-openssl/package"
BDIR="bind-$VERSION"
UVDIR="libuv-$LIBUV_VERSION"
URCUDIR="userspace-rcu-$URCU_VERSION"

# wasix-sysroot -39, not install-wasixcc's default: its dlmalloc refreshes a
# thread's view of a grown shared memory (#1287), and BIND runs threads.
# Literal values, so cert-review's input rule can read them; they must match
# the recipe's toolchain.wasix_sysroot.
export HOMESCOOP_WASIX_SYSROOT_VERSION=2025.9.30-39
export HOMESCOOP_WASIX_SYSROOT_SHA=6e80095d7c05ac443e145264db07d84d6a0086da8040ebf85bc488f587c47934
field() { node "$HOMESCOOP_ROOT/scripts/read-recipe.mjs" wasix-bind --field "$1"; }
[[ "$HOMESCOOP_WASIX_SYSROOT_VERSION" == "$(field toolchain.wasix_sysroot)" && "$HOMESCOOP_WASIX_SYSROOT_SHA" == "$(field toolchain.wasix_sysroot_sha256)" ]] \
  || { echo "homescoop wasix-bind: build.sh's wasix-sysroot pin isn't recipe.yaml's toolchain.wasix_sysroot" >&2; exit 1; }
eval "$(bash "$HOMESCOOP_ROOT/scripts/install-wasixcc.sh" "${WASIX_BIND_WASIXCC:-$WORK/wasixcc-$HOMESCOOP_WASIX_SYSROOT_VERSION}")"
test "$(node -p "require(process.argv[1]).version" "$WASIXCC_SYSROOT_PREFIX/package.json")" = "$HOMESCOOP_WASIX_SYSROOT_VERSION"
SYSROOT_VER="$(sed -n 's/.*sysroot=\([^ ]*\).*/\1/p' "$WASIXCC_PREFIX/.homescoop-toolchain" | head -1)"
[[ -n "$SYSROOT_VER" ]] || { echo "homescoop wasix-bind: no sysroot= in $WASIXCC_PREFIX/.homescoop-toolchain" >&2; exit 1; }
export PATH="${WASIXCC_PREFIX}/bin:${WASIXCC_LLVM_LOCATION}/bin:$PATH"
export WASIXCC_RUN_WASM_OPT=no
export WASIXCC_WASM_EXCEPTIONS=no
export WASIXCC_PIC=no
export WASIXCC_MODULE_KIND=static-main
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig:$OPENSSL_PREFIX/lib/pkgconfig"
export PKG_CONFIG_LIBDIR="$PKG_CONFIG_PATH"
unset CFLAGS CPPFLAGS LDFLAGS CXX

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) BUILD_TRIPLE=aarch64-apple-darwin ;;
  Darwin-x86_64) BUILD_TRIPLE=x86_64-apple-darwin ;;
  Linux-x86_64) BUILD_TRIPLE=x86_64-pc-linux-gnu ;;
  Linux-aarch64) BUILD_TRIPLE=aarch64-unknown-linux-gnu ;;
  *) echo "homescoop wasix-bind: unsupported build host $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac
CROSS=(--host=wasm32-unknown-wasi --build="$BUILD_TRIPLE"
  CC=wasixcc CXX=wasix++ AR=llvm-ar RANLIB=llvm-ranlib STRIP=llvm-strip)

# WASIX_BIND_REUSE=1 keeps a finished build tree and only stages (local
# iteration on the package; CI always builds from scratch).
REUSE=""
[[ -n "${WASIX_BIND_REUSE:-}" && -f "$BUILD/$BDIR/bin/dig/dig" ]] && REUSE=1
[[ -n "$REUSE" ]] || rm -rf "$BUILD" "$PREFIX" "$DEPS"
mkdir -p "$SRCS" "$BUILD" "$PREFIX" "$DEPS/wasix-openssl"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$SRCS/$BDIR.tar.xz"
homescoop_fetch "$LIBUV_SRC_URL" "$LIBUV_SRC_SHA" "$SRCS/$UVDIR.tar.gz"
homescoop_fetch "$URCU_SRC_URL" "$URCU_SRC_SHA" "$SRCS/$URCUDIR.tar.bz2"
homescoop_fetch "$WASIX_OPENSSL_SRC_URL" "$WASIX_OPENSSL_SRC_SHA" "$SRCS/wasix-openssl.tgz"
tar xzf "$SRCS/wasix-openssl.tgz" -C "$DEPS/wasix-openssl"
test -f "$OPENSSL_PREFIX/lib/libcrypto.a" && test -f "$OPENSSL_PREFIX/include/openssl/evp.h"
OPENSSL_PKG="$(node -p "require('$OPENSSL_PREFIX/package.json').version")"

patch_tree() {
  local dir="$1" p="$PKG/patches/$1-wasix.patch"
  [[ -f "$p" ]] || return 0
  echo "== patch $(basename "$p")"
  patch -d "$BUILD/$dir" -p1 < "$p"
}

step() {
  local name="$1"
  shift
  echo "== $name"
  "$@" > "$BUILD/$name.log" 2>&1 || { echo "homescoop wasix-bind: $name failed; log in $BUILD/$name.log" >&2; tail -40 "$BUILD/$name.log" >&2; exit 1; }
}

if [[ -z "$REUSE" ]]; then
tar xzf "$SRCS/$UVDIR.tar.gz" -C "$BUILD"
step libuv-configure cmake -S "$BUILD/$UVDIR" -B "$BUILD/$UVDIR-build" -G "Unix Makefiles" \
  -DCMAKE_TOOLCHAIN_FILE="$BUILD/$UVDIR/wasix-toolchain.cmake" -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" -DLIBUV_BUILD_SHARED=OFF -DLIBUV_BUILD_TESTS=OFF -DLIBUV_BUILD_BENCH=OFF
step libuv-build cmake --build "$BUILD/$UVDIR-build" --target install -j "$JOBS"
cp "$PREFIX/lib/pkgconfig/libuv-static.pc" "$PREFIX/lib/pkgconfig/libuv.pc"

tar xjf "$SRCS/$URCUDIR.tar.bz2" -C "$BUILD"
patch_tree "$URCUDIR"
(
  cd "$BUILD/$URCUDIR"
  step urcu-configure ./configure "${CROSS[@]}" --prefix="$PREFIX" --disable-shared --enable-static \
    --enable-compiler-atomic-builtins CFLAGS=-O2
  step urcu-build make -j"$JOBS" -C src
  step urcu-install sh -c 'make -C src install && make -C include install'
)

tar xJf "$SRCS/$BDIR.tar.xz" -C "$BUILD"
patch_tree "$BDIR"
(
  cd "$BUILD/$BDIR"
  find . -name Makefile.in -exec touch {} +
  touch aclocal.m4 configure config.h.in
  # /etc/resolv.conf is where slicc keeps it; nothing else is read at run time.
  step bind-configure ./configure "${CROSS[@]}" --prefix=/usr --sysconfdir=/etc --localstatedir=/var \
    --disable-shared --enable-static --with-openssl="$OPENSSL_PREFIX" \
    --disable-doh --without-libxml2 --without-json-c --without-zlib --without-lmdb --without-gssapi \
    --without-maxminddb --disable-geoip --without-libidn2 --without-cmocka --without-jemalloc \
    --with-readline=no --disable-dnstap --disable-tcp-fastopen --disable-chroot CFLAGS=-O2
  for d in isc dns isccc ns isccfg; do
    step "bind-lib-$d" make -j"$JOBS" -C "lib/$d"
  done
  step bind-dig make -j"$JOBS" -C bin/dig
)
fi

rm -rf "$DEST/bin" "$DEST/licenses" "$DEST/patches"
mkdir -p "$DEST/bin" "$DEST/licenses" "$DEST/patches"
# Drop the .debug_* custom sections (a few objects carry DWARF with build
# paths); keep the name section for stack traces and slicc.libc.
strip_debug() {
  python3 - "$1" "$2" <<'PY2'
import sys
src, out = sys.argv[1], sys.argv[2]
d = open(src, "rb").read()
def leb(i):
    r = s = 0
    while True:
        b = d[i]; i += 1; r |= (b & 0x7F) << s; s += 7
        if b < 0x80:
            return r, i
res, i = bytearray(d[:8]), 8
while i < len(d):
    start = i
    sid = d[i]; i += 1
    n, i = leb(i)
    end = i + n
    if sid == 0:
        ln, j = leb(i)
        if d[j:j + ln].startswith(b".debug_"):
            i = end
            continue
    res += d[start:end]
    i = end
open(out, "wb").write(res)
PY2
}
for b in dig host nslookup; do
  strip_debug "$BUILD/$BDIR/bin/dig/$b" "$DEST/bin/$b.wasm"
  grep -aqF "wasix-sysroot $SYSROOT_VER" "$DEST/bin/$b.wasm" || { echo "homescoop wasix-bind: $b.wasm lacks the slicc.libc marker" >&2; exit 1; }
done

python3 - "$DEST" <<'PY'
import pathlib, sys
dest = pathlib.Path(sys.argv[1])
magics = (b"\x7fELF", b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xfe\xed\xfa\xce", b"\xca\xfe\xba\xbe")
needles = (b"/opt/homebrew/", b"/usr/local/opt/", b"/Users/", b"/home/runner/", b"C:\\")
for p in dest.rglob("*"):
    if not p.is_file():
        continue
    data = p.read_bytes()
    if any(data.startswith(m) for m in magics):
        raise SystemExit(f"homescoop wasix-bind: host binary leaked: {p}")
    if p.suffix == ".wasm":
        for n in needles:
            if n in data:
                raise SystemExit(f"homescoop wasix-bind: host path {n!r} in {p}")
print("host-artefact check: no ELF/Mach-O, no host paths in wasm")
PY

homescoop_stage_license "$BUILD/$BDIR/LICENSE"
cp "$BUILD/$BDIR/LICENSE" "$DEST/licenses/bind-LICENSE"
cp "$BUILD/$BDIR/COPYRIGHT" "$DEST/licenses/bind-COPYRIGHT"
cp "$BUILD/$UVDIR/LICENSE" "$DEST/licenses/libuv-LICENSE"
cp "$BUILD/$UVDIR/LICENSE-extra" "$DEST/licenses/libuv-LICENSE-extra"
cp "$BUILD/$URCUDIR/LICENSE.md" "$DEST/licenses/userspace-rcu-LICENSE.md"
for f in LGPL-2.1-or-later MIT BSD-2-Clause LicenseRef-Boehm-GC; do
  cp "$BUILD/$URCUDIR/LICENSES/$f.txt" "$DEST/licenses/userspace-rcu-$f.txt"
done
cp "$PKG"/patches/*.patch "$DEST/patches/"

homescoop_notices_begin "The dig, host and nslookup wasm modules statically link BIND $VERSION's libraries (MPL-2.0, package/LICENSE), libuv, userspace-rcu and OpenSSL, and the wasix libc."
homescoop_notice "libuv 1.51.0 (wasix-org/libuv $LIBUV_VERSION), MIT" \
  "$BUILD/$UVDIR/LICENSE" - "$BUILD/$UVDIR/LICENSE-extra" -
homescoop_notice "userspace-rcu $URCU_VERSION, LGPL-2.1-or-later (headers MIT and others, see licenses/)" \
  "$BUILD/$URCUDIR/LICENSE.md" - "$BUILD/$URCUDIR/LICENSES/LGPL-2.1-or-later.txt" -
homescoop_notice "OpenSSL 3.5.9 (@ai-ecoverse/wasix-openssl $OPENSSL_PKG), Apache-2.0" "$OPENSSL_PREFIX/LICENSE" -
WLIBC=https://raw.githubusercontent.com/wasix-org/wasix-libc/v2026-07-03.1
homescoop_notice "wasix-libc (@ai-ecoverse/wasix-sysroot $SYSROOT_VER; files from tag v2026-07-03.1)" \
  "$WLIBC/LICENSE" da1128117561950db9e04201ce9ac3f0bd9e3baf852289211608b73098d51ac0 \
  "$WLIBC/LICENSE-APACHE-LLVM" 268872b9816f90fd8e85db5a28d33f8150ebb8dd016653fb39ef1f94f2686bc5 \
  "$WLIBC/LICENSE-MIT" 23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3 \
  "$WLIBC/libc-top-half/musl/COPYRIGHT" f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af \
  "$WLIBC/libc-bottom-half/cloudlibc/LICENSE" c8b789cf5a746611e6300a0cc7750dbf92b61912a709d04e639245f7290656d0

{
  echo "# Sources"
  echo
  echo "Upstream sources, with \`patches/\` applied:"
  echo
  echo "| source | sha256 |"
  echo "| --- | --- |"
  echo "| [$BDIR.tar.xz]($SRC_URL) | \`$SRC_SHA\` |"
  echo "| [wasix-org/libuv $LIBUV_VERSION]($LIBUV_SRC_URL) | \`$LIBUV_SRC_SHA\` |"
  echo "| [$URCUDIR.tar.bz2]($URCU_SRC_URL) | \`$URCU_SRC_SHA\` |"
  echo "| [@ai-ecoverse/wasix-openssl $OPENSSL_PKG]($WASIX_OPENSSL_SRC_URL) | \`$WASIX_OPENSSL_SRC_SHA\` |"
  echo
  echo "Build recipe: https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasix-bind"
} >"$DEST/SOURCES.md"

python3 - "$DEST" "$VERSION" "$PKG_VER" "$SYSROOT_VER" "$OPENSSL_PKG" "$LIBUV_VERSION" "$URCU_VERSION" <<'PY'
import json, sys
from pathlib import Path
dest, ver, pkg_ver, sysroot, openssl, libuv, urcu = Path(sys.argv[1]), *sys.argv[2:]
old = json.loads((dest / "package.json").read_text())
cmds = {name: {"wasm": f"bin/{name}.wasm"} for name in ("dig", "host", "nslookup")}
for c in cmds.values():
    assert (dest / c["wasm"]).is_file(), c
pkg = {
    "name": "@ai-ecoverse/wasix-bind",
    "version": pkg_ver,
    "description": old["description"],
    "license": "MPL-2.0",
    "engines": old["engines"],
    "repository": {"type": "git", "url": "git+https://github.com/ai-ecoverse/homescoop.git", "directory": "packages/wasix-bind/package"},
    "homepage": "https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasix-bind",
    "keywords": ["wasm", "wasix", "slicc", "homescoop", "bind", "dns", "dig", "host", "nslookup"],
    "files": ["README.md", "LICENSE", "THIRD-PARTY-NOTICES.md", "SOURCES.md", "bin", "licenses", "patches"],
    "publishConfig": {"access": "public"},
    "homescoop": {
        "recipe": "wasix-bind",
        "upstream": ver,
        "libuv": f"wasix-org/libuv@{libuv}",
        "urcu": urcu,
        "openssl": f"@ai-ecoverse/wasix-openssl@{openssl}",
        "sysroot": f"@ai-ecoverse/wasix-sysroot@{sysroot}",
    },
    "slicc": {"abi": "wasi", "commands": cmds},
}
(dest / "package.json").write_text(json.dumps(pkg, indent=2) + "\n")
print("package.json", pkg_ver, sorted(cmds))
PY

echo "== wasix-bind staged $PKG_VER"
ls -la "$DEST/bin"
