#!/usr/bin/env bash
# wasix-f2c: Fortran 77 for wasm32-wasix through f2c (a build input for
# py-scipy). Ships libf2c.a (CLAPACK 3.2.1's F2CLIBS with Pyodide's patches,
# PIC, wasix-sysroot -38), f2c.h, the f2c translator's pinned source with
# bin/build-f2c.sh (a host tool, built at use time) and bin/gfortran, the
# gfortran -> f2c -> wasixcc wrapper.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasix-f2c
field() { node "$ROOT/scripts/read-recipe.mjs" wasix-f2c --field "$1"; }

B="$(cd /tmp && pwd -P)/homescoop-wasix-f2c-$VERSION"
rm -rf "$B" && mkdir -p "$B"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$WORK/clapack-$VERSION.tgz"
eval "$(node "$ROOT/scripts/recipe-env.mjs" wasix-f2c --source f2c)"
homescoop_fetch "$F2C_URL" "$F2C_SHA" "$WORK/f2c-$(field sources.f2c.commit).tar.gz"
tar -xzf "$WORK/clapack-$VERSION.tgz" -C "$B"
CLAPACK="$B/CLAPACK-$VERSION"
mkdir -p "$B/f2c"
tar -xzf "$WORK/f2c-$(field sources.f2c.commit).tar.gz" -C "$B/f2c" --strip-components=1

# wasix-sysroot -38, not install-wasixcc's default. Literal values, so
# cert-review's input rule can read them; they must match the recipe's
# toolchain.wasix_sysroot, which wasix-lib-cert.mjs installs for the cert.
export HOMESCOOP_WASIX_SYSROOT_VERSION=2025.9.30-38
export HOMESCOOP_WASIX_SYSROOT_SHA=1fb57c95d84e7b33a5a535561a0d536c943c40fefd70991f9570db8e27994574
[[ "$HOMESCOOP_WASIX_SYSROOT_VERSION" == "$(field toolchain.wasix_sysroot)" && "$HOMESCOOP_WASIX_SYSROOT_SHA" == "$(field toolchain.wasix_sysroot_sha256)" ]] \
  || { echo "homescoop: build.sh's wasix-sysroot pin isn't recipe.yaml's toolchain.wasix_sysroot" >&2; exit 1; }
eval "$(bash "$ROOT/scripts/install-wasixcc.sh" "$WORK/wasixcc-$HOMESCOOP_WASIX_SYSROOT_VERSION")"
test "$(node -p "require(process.argv[1]).version" "$WASIXCC_SYSROOT_PREFIX/package.json")" = "$HOMESCOOP_WASIX_SYSROOT_VERSION"
unset CCC_OVERRIDE_OPTIONS WASIXCC_MODULE_KIND WASIXCC_INCLUDE_CPP_SYMBOLS || true
# PIC objects for scipy's side modules (the ehpic tree; C, so no EH code).
export WASIXCC_RUN_WASM_OPT=no WASIXCC_PIC=yes WASIXCC_WASM_EXCEPTIONS=legacy

echo "== wasix-f2c: libf2c patches (Pyodide's, via py-scipy)"
for p in "$HOMESCOOP_PKG"/patches/libf2c/000*.patch; do
  echo "   $(basename "$p")"
  patch -d "$CLAPACK" -p1 --batch --no-backup-if-mismatch -s <"$p"
done
cp "$HOMESCOOP_PKG/patches/libf2c/make.inc" "$CLAPACK/make.inc"
LIBF2C="$CLAPACK/F2CLIBS/libf2c"
# arith.h describes the target's arithmetic. arith-wasm32.h is what
# arithchk.c prints on wasm32 (IEEE little-endian, 32-bit long and
# pointers). The host's arithchk must agree on everything but its LP64
# lines (Long, Intcast, X64_bit_pointers), which libf2c doesn't depend on.
HOSTCC="$(command -v cc)"
"$HOSTCC" -DNO_FPINIT -O0 -o "$B/arithchk" "$LIBF2C/arithchk.c" -lm
"$B/arithchk" >"$B/arith-host.h"
if ! diff <(grep -vE '^#define (Long|Intcast|X64_bit_pointers)( |$)' "$B/arith-host.h") "$HOMESCOOP_PKG/arith-wasm32.h" >&2; then
  echo "homescoop wasix-f2c: the host's arithchk disagrees with arith-wasm32.h beyond its LP64 lines" >&2
  exit 1
fi
cp "$HOMESCOOP_PKG/arith-wasm32.h" "$LIBF2C/arith.h"
touch "$LIBF2C/arith.h"
cp "$LIBF2C/signal1.h0" "$LIBF2C/signal1.h"
cp "$LIBF2C/sysdep1.h0" "$LIBF2C/sysdep1.h"
MAP="-ffile-prefix-map=$CLAPACK=/clapack"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
echo "== wasix-f2c: libf2c.a"
make -C "$LIBF2C" -j"$JOBS" CC=wasixcc CFLAGS="-O2 -fPIC -I. -DNO_BLAS_WRAP -DSkip_f2c_Undefs $MAP" \
  AR=wasixar ARCH=wasixar ARCHFLAGS=cr RANLIB=wasixranlib libf2c.a >"$B/libf2c.log" 2>&1 || { tail -40 "$B/libf2c.log" >&2; exit 1; }

DEST="$HOMESCOOP_PKG/package"
rm -rf "$DEST/lib" "$DEST/include" "$DEST/share" "$DEST/bin"
mkdir -p "$DEST/lib/pkgconfig" "$DEST/include" "$DEST/share/f2c/src" "$DEST/bin"
# The wrapper and the f2c build script (packages/wasix-f2c/bin).
install -m 755 "$HOMESCOOP_PKG/bin/gfortran" "$HOMESCOOP_PKG/bin/build-f2c.sh" "$DEST/bin/"
cp "$LIBF2C/libf2c.a" "$DEST/lib/libf2c.a"
wasixranlib "$DEST/lib/libf2c.a"
# The f2c.h that f2c -R output is compiled against: hoodmane/f2c's.
cp "$B/f2c/f2c.h" "$DEST/include/f2c.h"
# The translator's source, built on the host by bin/build-f2c.sh.
for f in "$B"/f2c/src/*; do
  case "$(basename "$f")" in makefile.vc|mkfile.plan9|f2c.1t) continue ;; esac
  cp "$f" "$DEST/share/f2c/src/"
done
cat >"$DEST/lib/pkgconfig/f2c.pc" <<PC
prefix=\${pcfiledir}/../..
libdir=\${prefix}/lib
includedir=\${prefix}/include

Name: f2c
Description: libf2c from CLAPACK $VERSION for WASIX (static PIC; Pyodide's patches) and f2c.h
Version: $VERSION
Libs: -L\${libdir} -lf2c
Libs.private: -lm
Cflags: -I\${includedir}
PC

# A smoke run of the shipped translator and wrapper on the build host.
F2C="$(WASIX_F2C_CACHE="$B/f2c-cache" bash "$DEST/bin/build-f2c.sh" | tail -1)"
"$F2C" -R <"$HOMESCOOP_PKG/test/fprobe.f" >"$B/fprobe.c" 2>"$B/f2c.log" || { cat "$B/f2c.log" >&2; exit 1; }
grep -q 'saxpy_' "$B/fprobe.c"
# meson's identity probes, answered without a host gfortran.
env -u REAL_GFORTRAN python3 "$DEST/bin/gfortran" --version | grep -q '^GNU Fortran .* 13\.2\.0$'
test "$(env -u REAL_GFORTRAN python3 "$DEST/bin/gfortran" -dumpversion)" = 13.2.0
env -u REAL_GFORTRAN python3 "$DEST/bin/gfortran" -E -dM - </dev/null | grep -q '^#define __GFORTRAN__ 1$'
env -u REAL_GFORTRAN python3 "$DEST/bin/gfortran" -E -dM - </dev/null | grep -q '^#define __wasm32__ 1$'

NM="$WASIXCC_LLVM_LOCATION/bin/llvm-nm"
syms="$("$NM" -g --defined-only "$DEST/lib/libf2c.a" 2>/dev/null)"
for s in s_wsle e_wsle do_lio s_cat s_copy s_cmp pow_dd pow_di z_div i_len __main_argc_argv; do
  grep -qE " [TW] $s\$" <<<"$syms" || { echo "homescoop wasix-f2c: $s is not in libf2c.a" >&2; exit 1; }
done
# 0005: c_abs and z_abs are OpenBLAS's, so the two link together.
for s in c_abs z_abs; do
  if grep -qE " [TW] $s\$" <<<"$syms"; then echo "homescoop wasix-f2c: libf2c.a defines $s (0005 missing)" >&2; exit 1; fi
done
LEAK="$B|$WORK|/home/|/Users/|/__w/|/private/(tmp|var)/|/var/folders/"
if LC_ALL=C grep -aEq "$LEAK" "$DEST/lib/libf2c.a" "$DEST/include/f2c.h"; then
  echo "homescoop wasix-f2c: a build path leaked into the package" >&2
  exit 1
fi

homescoop_stage_licenses "$LIBF2C/Notice" "$B/f2c/LICENSE.txt"
homescoop_notices_begin "libf2c.a is CLAPACK $VERSION's F2CLIBS/libf2c (its Notice is in LICENSE) with Pyodide's patches; share/f2c/src and f2c.h are hoodmane/f2c $(field sources.f2c.commit) (LICENSE.txt, also in LICENSE); bin/gfortran follows pyodide-build (MPL-2.0). libf2c.a is compiled against and meant to be linked with the following."
WLIBC=https://raw.githubusercontent.com/wasix-org/wasix-libc/v2026-07-03.1
homescoop_notice "wasix-libc headers (@ai-ecoverse/wasix-sysroot $HOMESCOOP_WASIX_SYSROOT_VERSION; files from tag v2026-07-03.1)" \
  "$WLIBC/LICENSE" da1128117561950db9e04201ce9ac3f0bd9e3baf852289211608b73098d51ac0 \
  "$WLIBC/LICENSE-MIT" 23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3 \
  "$WLIBC/libc-top-half/musl/COPYRIGHT" f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af
homescoop_assert_no_package_links "$DEST"
du -sh "$DEST/lib/libf2c.a" "$DEST/share/f2c/src"
echo "== wasix-f2c: staged $VERSION"
