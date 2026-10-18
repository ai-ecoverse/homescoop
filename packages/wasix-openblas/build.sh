#!/usr/bin/env bash
# wasix-openblas: a static, PIC OpenBLAS 0.3.28 for wasm32-wasix (a build
# input: py-numpy and py-scipy link it). NOFORTRAN=1 (LAPACK is OpenBLAS's
# C translation of netlib, built with `make netlib`), TARGET=RISCV64_GENERIC
# C kernels, single-threaded, the f2c int ABI (wasm-abi.py), as
# packages/py-numpy/tools/build-openblas.sh and Pyodide.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasix-openblas
field() { node "$ROOT/scripts/read-recipe.mjs" wasix-openblas --field "$1"; }

# A fixed build directory: the objects then carry no per-run path.
B="$(cd /tmp && pwd -P)/homescoop-wasix-openblas-$VERSION"
SRC="$B/OpenBLAS-$VERSION"
rm -rf "$B" && mkdir -p "$B"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$WORK/OpenBLAS-$VERSION.tar.gz"
tar -xzf "$WORK/OpenBLAS-$VERSION.tar.gz" -C "$B"

# The recipe's sysroot (toolchain.wasix_sysroot), not install-wasixcc's default.
export HOMESCOOP_WASIX_SYSROOT_VERSION="$(field toolchain.wasix_sysroot)"
export HOMESCOOP_WASIX_SYSROOT_SHA="$(field toolchain.wasix_sysroot_sha256)"
eval "$(bash "$ROOT/scripts/install-wasixcc.sh" "$WORK/wasixcc-$HOMESCOOP_WASIX_SYSROOT_VERSION")"
test "$(node -p "require(process.argv[1]).version" "$WASIXCC_SYSROOT_PREFIX/package.json")" = "$HOMESCOOP_WASIX_SYSROOT_VERSION"
unset CCC_OVERRIDE_OPTIONS WASIXCC_MODULE_KIND WASIXCC_INCLUDE_CPP_SYMBOLS PKG_CONFIG_LIBDIR PKG_CONFIG_PATH || true
# PIC objects (python's ehpic tree; wasixcc builds PIC only with wasm
# exceptions, and OpenBLAS is C, so they carry no EH code).
export WASIXCC_RUN_WASM_OPT=no WASIXCC_PIC=yes WASIXCC_WASM_EXCEPTIONS=legacy
HOSTCC="$(command -v cc)"
# Makefile.riscv64's -march/-mabi/-mtune are meaningless for wasm32.
WRAP="$B/wasixcc-openblas"
cat >"$WRAP" <<'WRAP'
#!/usr/bin/env bash
args=()
for a in "$@"; do
  case "$a" in -march=*|-mabi=*|-mtune=*) continue ;; esac
  args+=("$a")
done
exec wasixcc "${args[@]}"
WRAP
chmod +x "$WRAP"

(cd "$SRC" && python3 "$HOMESCOOP_PKG/wasm-abi.py")

JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
MAP="-ffile-prefix-map=$SRC=/openblas -ffile-prefix-map=$B=/openblas-build"
OB_MAKE=(
  CC="$WRAP" HOSTCC="$HOSTCC" AR=wasixar RANLIB=wasixranlib
  TARGET=RISCV64_GENERIC BINARY=32 NOFORTRAN=1 USE_THREAD=0 NUM_THREADS=1
  NO_SHARED=1 NO_LAPACKE=1 NO_AFFINITY=1 CROSS=1
  COMMON_OPT="-O2 -Wno-return-type -fPIC -DOS_EMBEDDED -DMAX_STACK_ALLOC=2048 $MAP"
)
echo "== wasix-openblas: make libs (BLAS, CBLAS)"
make -C "$SRC" -j"$JOBS" "${OB_MAKE[@]}" ONLY_CBLAS=0 libs >"$B/libs.log" 2>&1 || { tail -60 "$B/libs.log" >&2; exit 1; }
echo "== wasix-openblas: make netlib (LAPACK, C)"
make -C "$SRC" -j"$JOBS" "${OB_MAKE[@]}" netlib >"$B/netlib.log" 2>&1 || { tail -60 "$B/netlib.log" >&2; exit 1; }
echo "== wasix-openblas: make install (headers: cblas.h, f77blas.h, openblas_config.h)"
make -C "$SRC" "${OB_MAKE[@]}" PREFIX="$B/prefix" install >"$B/install.log" 2>&1 || { tail -40 "$B/install.log" >&2; exit 1; }
LIBA="$(ls -1 "$B"/prefix/lib/libopenblas_*.a | head -1)"
test -f "$LIBA"

DEST="$HOMESCOOP_PKG/package"
rm -rf "$DEST/lib" "$DEST/include"
mkdir -p "$DEST/lib/pkgconfig" "$DEST/include"
cp "$LIBA" "$DEST/lib/libopenblas.a"
# tmglib (lapack-netlib/TESTING/MATGEN, LAPACK's test-matrix generators) is
# not part of the library numpy and scipy link.
"$WASIXCC_LLVM_LOCATION/bin/llvm-ar" t "$DEST/lib/libopenblas.a" \
  | grep -E '^[sdcz](latm|lagge|lagsy|laghe|lahilb|laran|latme|latmr|latmt|latms|lakf2|large|laror|larot|larnd)' >"$B/tmglib.txt" || true
if [[ -s "$B/tmglib.txt" ]]; then
  xargs -n 40 wasixar d "$DEST/lib/libopenblas.a" <"$B/tmglib.txt"
  echo "== wasix-openblas: dropped $(wc -l <"$B/tmglib.txt" | tr -d ' ') tmglib objects"
fi
wasixranlib "$DEST/lib/libopenblas.a"
for h in cblas.h f77blas.h openblas_config.h; do
  cp "$B/prefix/include/$h" "$DEST/include/"
done
python3 - "$DEST/include/cblas.h" <<'PY'
import re, sys
p = sys.argv[1]
t = re.sub(r"void(\s+)cblas_", r"int\1cblas_", open(p).read())
open(p, "w").write(t)
assert not re.search(r"void\s+cblas_", t)
PY
for n in openblas blas lapack cblas; do
  cat >"$DEST/lib/pkgconfig/$n.pc" <<PC
prefix=\${pcfiledir}/../..
libdir=\${prefix}/lib
includedir=\${prefix}/include
openblas_config=USE_THREAD=0 NO_LAPACKE NO_AFFINITY RISCV64_GENERIC INT_ABI

Name: openblas
Description: OpenBLAS $VERSION for WASIX (static PIC, NOFORTRAN=1, RISCV64_GENERIC, C netlib LAPACK, f2c int ABI, single-threaded)
Version: $VERSION
URL: http://www.openblas.net/
Libs: -L\${libdir} -lopenblas
Libs.private: -lm
Cflags: -I\${includedir}
PC
done

NM="$WASIXCC_LLVM_LOCATION/bin/llvm-nm"
syms="$("$NM" -g --defined-only "$DEST/lib/libopenblas.a" 2>/dev/null)"
for s in cblas_dgemm dgemm_ ddot_ dgesv_ dgesvd_ dsyevd_ zgemm_ openblas_get_config; do
  grep -qE " [TW] $s\$" <<<"$syms" || { echo "homescoop wasix-openblas: $s is not defined" >&2; exit 1; }
done
# No libc stand-ins (memory.c's OS_EMBEDDED stubs; wasm-abi.py).
for s in puts printf getenv atoi; do
  if grep -qE " [TW] $s\$" <<<"$syms"; then echo "homescoop wasix-openblas: libopenblas.a defines libc's $s" >&2; exit 1; fi
done
# xerbla_ and xerbla_array_ are weak (wasm-abi.py), so a program's own
# (numpy's python_xerbla, scipy's wasix_stubs.c) wins without duplicates.
for s in xerbla_ xerbla_array_; do
  grep -qE " W $s\$" <<<"$syms" || { echo "homescoop wasix-openblas: $s is not weak" >&2; grep -E 'xerbla' <<<"$syms" >&2; exit 1; }
done
LEAK="$B|$WORK|/home/|/Users/|/__w/|/private/(tmp|var)/|/var/folders/"
if LC_ALL=C grep -aEq "$LEAK" "$DEST/lib/libopenblas.a" "$DEST"/include/*.h; then
  echo "homescoop wasix-openblas: a build path leaked into the package" >&2
  LC_ALL=C grep -aEo "$LEAK[^ \"]*" "$DEST/lib/libopenblas.a" | sort -u | head >&2
  exit 1
fi

homescoop_stage_licenses "$SRC/LICENSE" "$SRC/lapack-netlib/LICENSE" "$SRC/GotoBLAS_00License.txt"
homescoop_notices_begin "libopenblas.a is OpenBLAS (BSD-3-Clause) with its C translation of netlib LAPACK (BSD-3-Clause) and GotoBLAS2 code (BSD-2-Clause); see LICENSE. It is compiled against and meant to be linked with the following."
WLIBC=https://raw.githubusercontent.com/wasix-org/wasix-libc/v2026-07-03.1
homescoop_notice "wasix-libc headers (@ai-ecoverse/wasix-sysroot $HOMESCOOP_WASIX_SYSROOT_VERSION; files from tag v2026-07-03.1)" \
  "$WLIBC/LICENSE" da1128117561950db9e04201ce9ac3f0bd9e3baf852289211608b73098d51ac0 \
  "$WLIBC/LICENSE-MIT" 23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3 \
  "$WLIBC/libc-top-half/musl/COPYRIGHT" f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af
homescoop_assert_no_package_links "$DEST"
du -sh "$DEST/lib/libopenblas.a"
echo "== wasix-openblas: staged $VERSION"
