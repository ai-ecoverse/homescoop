#!/usr/bin/env bash
# Cross-build GnuPG 2.4 and its libraries for slicc WASIX via wasixcc.
#
# - npth needs pthreads and gpg-agent is a threaded daemon on an AF_UNIX
#   socket: WASIX (real threads), not Emscripten.
# - No Asyncify anywhere: every spawn is posix_spawn (proc_spawn3) and
#   gpg-agent --daemon detaches by spawning itself (gnupg-*-wasi.patch).
# - Needs wasix-sysroot >= 2025.9.30-15: its libc reports files as the realm
#   user's (st_uid/st_gid = getuid()), which GnuPG's homedir checks require.
set -euo pipefail

HOMESCOOP_ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=/dev/null
source "$HOMESCOOP_ROOT/scripts/build-common.sh"
homescoop_load_recipe wasix-gnupg

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
VER="$VERSION"
PKG_VER="${VER}-3"
WORK="${WASIX_GNUPG_WORK:-$PKG/.work}"
SRCS="$WORK/src"
BUILD="$WORK/build"
PREFIX="$WORK/prefix"
JOBS="${HOMESCOOP_JOBS:-8}"

# name version sha256 url-dir
LIBS=(
  "libgpg-error 1.61 7a85413f2bc354f4f8aa832b718af122e48965e9e0eb9012ee659c13c6385c93"
  "npth 1.8 8bd24b4f23a3065d6e5b26e98aba9ce783ea4fd781069c1b35d149694e90ca3e"
  "libgcrypt 1.12.4 d77f68f48879510e79a2f65977ccc68981781ea0923e5bdffac2a193ea3d660e"
  "libassuan 3.0.2 d2931cdad266e633510f9970e1a2f346055e351bb19f9b78912475b8074c36f6"
  "libksba 1.8.1 c2f84393011827219ae117131dba8e7684c2bed0961eed11b0642c2acba440b5"
)

export PATH="$PREFIX/bin:${WASIXCC_PREFIX:-$HOME/.wasixcc}/bin:$HOME/.wasixcc/llvm/bin:$HOME/.wasmer/bin:/opt/homebrew/bin:$PATH"
export WASIXCC_RUN_WASM_OPT=no
export WASIXCC_WASM_EXCEPTIONS=no
export WASIXCC_PIC=no
export WASIXCC_MODULE_KIND=static-main
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"
# Never pick up a host (Homebrew) gpgrt-config: it answers for darwin.
export GPGRT_CONFIG="$PREFIX/bin/gpgrt-config"
unset CFLAGS CPPFLAGS LDFLAGS CXX PKG_CONFIG_LIBDIR

command -v wasixcc >/dev/null || { echo "homescoop wasix-gnupg: wasixcc not on PATH" >&2; exit 1; }
SYSROOT_LIBC="${WASIXCC_SYSROOT_PREFIX:-$HOME/.wasixcc/sysroot}/sysroot/lib/wasm32-wasi/libc.a"
llvm-ar t "$SYSROOT_LIBC" | grep -qx slicc_stat_owner.o || {
  echo "homescoop wasix-gnupg: $SYSROOT_LIBC predates wasix-sysroot 2025.9.30-15 (no slicc_stat_owner.o)" >&2
  exit 1
}

BUILD_TRIPLE="$(/usr/bin/uname -m)-apple-darwin"
BUILD_TRIPLE="${BUILD_TRIPLE/arm64/aarch64}"
CROSS=(--host=wasm32-unknown-wasi --build="$BUILD_TRIPLE"
  CC=wasixcc AR=llvm-ar RANLIB=llvm-ranlib STRIP=llvm-strip)
LIBCONF=("${CROSS[@]}" --prefix="$PREFIX" --disable-shared --enable-static)

mkdir -p "$SRCS" "$BUILD" "$PREFIX"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$SRCS/gnupg-$VER.tar.bz2"
for lib in "${LIBS[@]}"; do
  read -r name ver sha <<<"$lib"
  homescoop_fetch "https://gnupg.org/ftp/gcrypt/$name/$name-$ver.tar.bz2" "$sha" \
    "$SRCS/$name-$ver.tar.bz2"
done

# Fresh source tree with the recipe's patch for it (if any) applied.
unpack() {
  local dir="$1"
  rm -rf "${BUILD:?}/$dir"
  tar xjf "$SRCS/$dir.tar.bz2" -C "$BUILD"
  if [[ -f "$PKG/patches/$dir-wasi.patch" ]]; then
    echo "== patch $dir-wasi.patch"
    patch -d "$BUILD/$dir" -p1 < "$PKG/patches/$dir-wasi.patch"
  fi
}

build_lib() {
  local name="$1" ver="$2" dir="$1-$2"
  shift 2
  if [[ -f "$BUILD/$dir/.homescoop-installed" && -z "${FORCE:-}" ]]; then
    echo "== $dir already installed"
    return 0
  fi
  unpack "$dir"
  (
    cd "$BUILD/$dir"
    "$@"
    ./configure "${LIBCONF[@]}" "${EXTRA[@]}" CFLAGS="-O2" > "$BUILD/$dir.configure.log" 2>&1
    make -j"$JOBS" > "$BUILD/$dir.make.log" 2>&1
    make install >> "$BUILD/$dir.make.log" 2>&1
    touch .homescoop-installed
  ) || { echo "homescoop wasix-gnupg: $dir failed; logs in $BUILD/$dir.*.log" >&2; exit 1; }
  echo "== $dir installed"
}

# libgpg-error: no lock-obj for wasm32-unknown-wasi upstream. Ours is
# gen-posix-lock-obj's output for wasix-libc (run under wasmer).
gpgerr_prep() {
  cp "$PKG/patches/lock-obj-pub.wasm32-unknown-wasi.h" src/syscfg/
  # The gpg-error-config self-test hangs cross-compiling; it checks nothing we ship.
  printf '#!/bin/sh\nexit 0\n' > src/gpg-error-config-test.sh.in
}
EXTRA=(--disable-doc --disable-tests --disable-languages --disable-nls --enable-threads=posix)
build_lib libgpg-error 1.61 gpgerr_prep
EXTRA=()
build_lib npth 1.8 true
EXTRA=(--with-libgpg-error-prefix="$PREFIX" --disable-asm --disable-jent-support
  --enable-random=getentropy --disable-doc --disable-instrumentation-munging)
build_lib libgcrypt 1.12.4 true
EXTRA=(--with-libgpg-error-prefix="$PREFIX" --disable-doc)
build_lib libassuan 3.0.2 true
build_lib libksba 1.8.1 true


GDIR="gnupg-$VER"
unpack "$GDIR"
(
  cd "$BUILD/$GDIR"
  # /usr/bin: gpg starts /usr/bin/gpg-agent, which slicc resolves to the
  # installed command; nothing is read from /usr/share (no NLS, no docs).
  ./configure "${CROSS[@]}" --prefix=/usr --sysconfdir=/etc --localstatedir=/var \
    GPGRT_CONFIG="$GPGRT_CONFIG" \
    --with-libgpg-error-prefix="$PREFIX" --with-libgcrypt-prefix="$PREFIX" \
    --with-libassuan-prefix="$PREFIX" --with-ksba-prefix="$PREFIX" --with-npth-prefix="$PREFIX" \
    --disable-gpgsm --disable-scdaemon --disable-dirmngr --disable-keyboxd --disable-tpm2d \
    --disable-doc --disable-gpgtar --disable-wks-tools --disable-tofu --disable-sqlite \
    --disable-libdns --disable-ntbtls --disable-gnutls --disable-ldap --disable-nls \
    --disable-photo-viewers --disable-card-support --disable-dirmngr-auto-start \
    --disable-tests --disable-bzip2 --disable-zip --without-readline \
    CFLAGS="-O2" > "$BUILD/$GDIR.configure.log" 2>&1
  make -j"$JOBS" > "$BUILD/$GDIR.make.log" 2>&1
) || { echo "homescoop wasix-gnupg: $GDIR failed; logs in $BUILD/$GDIR.*.log" >&2; exit 1; }

rm -rf "$DEST/bin" "$DEST/licenses" "$DEST/patches"
mkdir -p "$DEST/bin" "$DEST/licenses" "$DEST/patches"
for b in g10/gpg g10/gpgv agent/gpg-agent tools/gpgconf tools/gpg-connect-agent; do
  cp "$BUILD/$GDIR/$b" "$DEST/bin/$(basename "$b").wasm"
done

# GPL-3: the package carries the licenses and the patches; with the
# upstream tarballs listed in SOURCES.md that is the corresponding source.
homescoop_stage_license "$BUILD/$GDIR/COPYING"
for f in COPYING COPYING.LGPL21 COPYING.LGPL3 COPYING.other; do
  cp "$BUILD/$GDIR/$f" "$DEST/licenses/gnupg-$f"
done
cp "$BUILD/libgpg-error-1.61/COPYING.LIB" "$DEST/licenses/libgpg-error-COPYING.LIB"
cp "$BUILD/libgcrypt-1.12.4/COPYING.LIB" "$DEST/licenses/libgcrypt-COPYING.LIB"
cp "$BUILD/libgcrypt-1.12.4/LICENSES" "$DEST/licenses/libgcrypt-LICENSES"
cp "$BUILD/libassuan-3.0.2/COPYING.LIB" "$DEST/licenses/libassuan-COPYING.LIB"
cp "$BUILD/libksba-1.8.1/COPYING.LGPLv3" "$DEST/licenses/libksba-COPYING.LGPLv3"
cp "$BUILD/libksba-1.8.1/COPYING.GPLv2" "$DEST/licenses/libksba-COPYING.GPLv2"
cp "$BUILD/npth-1.8/COPYING.LIB" "$DEST/licenses/npth-COPYING.LIB"
cp "$PKG"/patches/* "$DEST/patches/"

# The libraries' licences are in licenses/ (above). The wasix libc is linked
# in too; its licence files are pinned by tag (the sysroot is a 2025-09-30
# snapshot of wasix-libc, so this is the nearest earlier tag).
homescoop_notices_begin "The gpg, gpgv, gpg-agent, gpgconf and gpg-connect-agent wasm modules statically link libgpg-error 1.61, libgcrypt 1.12.4, libassuan 3.0.2, libksba 1.8.1 and npth 1.8 (licences in licenses/, sources in SOURCES.md) and the following."
WLIBC=https://raw.githubusercontent.com/wasix-org/wasix-libc/v2025-09-02.1
homescoop_notice "wasix-libc (@ai-ecoverse/wasix-sysroot 2025.9.30; files from tag v2025-09-02.1)" \
  "$WLIBC/LICENSE" da1128117561950db9e04201ce9ac3f0bd9e3baf852289211608b73098d51ac0 \
  "$WLIBC/LICENSE-APACHE-LLVM" 268872b9816f90fd8e85db5a28d33f8150ebb8dd016653fb39ef1f94f2686bc5 \
  "$WLIBC/LICENSE-MIT" 23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3 \
  "$WLIBC/libc-top-half/musl/COPYRIGHT" f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af \
  "$WLIBC/libc-bottom-half/cloudlibc/LICENSE" c8b789cf5a746611e6300a0cc7750dbf92b61912a709d04e639245f7290656d0

{
  echo "# Sources"
  echo
  echo "Upstream tarballs (https://gnupg.org/ftp/gcrypt/), with \`patches/\` applied:"
  echo
  echo "| tarball | sha256 |"
  echo "| --- | --- |"
  echo "| gnupg-$VER.tar.bz2 | \`$SRC_SHA\` |"
  for lib in "${LIBS[@]}"; do
    read -r name ver sha <<<"$lib"
    echo "| $name-$ver.tar.bz2 | \`$sha\` |"
  done
  echo
  echo "Build recipe: https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasix-gnupg"
} > "$DEST/SOURCES.md"

python3 - "$DEST" "$VER" "$PKG_VER" <<'PY'
import json, sys
from pathlib import Path
dest, ver, pkg_ver = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
cmds = {
    "gpg": {"wasm": "bin/gpg.wasm"},
    "gpg2": {"wasm": "bin/gpg.wasm", "argv0": "gpg"},
    "gpgv": {"wasm": "bin/gpgv.wasm"},
    "gpg-agent": {"wasm": "bin/gpg-agent.wasm"},
    "gpgconf": {"wasm": "bin/gpgconf.wasm"},
    "gpg-connect-agent": {"wasm": "bin/gpg-connect-agent.wasm"},
}
for c in cmds.values():
    assert (dest / c["wasm"]).is_file(), c
pkg = {
    "name": "@ai-ecoverse/wasix-gnupg",
    "version": pkg_ver,
    "description": "GnuPG 2.4 for slicc WASIX: gpg, gpgv, gpg-agent, gpgconf, gpg-connect-agent",
    "license": "GPL-3.0-or-later",
    "files": ["README.md", "LICENSE", "THIRD-PARTY-NOTICES.md", "SOURCES.md", "bin", "licenses", "patches"],
    "publishConfig": {"access": "public"},
    "homescoop": {
        "recipe": "wasix-gnupg",
        "upstream": ver,
        "libraries": "libgpg-error 1.61, libgcrypt 1.12.4, libassuan 3.0.2, libksba 1.8.1, npth 1.8 (static)",
    },
    "slicc": {"abi": "wasi", "commands": cmds},
}
(dest / "package.json").write_text(json.dumps(pkg, indent=2) + "\n")
print("package.json", pkg_ver, sorted(cmds))
PY
cp "$PKG/README.md" "$DEST/README.md"

echo "== wasix-gnupg staged $PKG_VER"
ls -la "$DEST/bin"
