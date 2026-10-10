#!/usr/bin/env bash
# wasix-sysroot 2025.9.30-17 on any host (CI): the published -14 package,
# byte for byte, plus slicc_stat_owner.o in every libc.a (replacing fstat.o
# and fstatat.o; -15, d292a32) and slicc_fs file modes (-16/-17, homescoop#169):
# patches/posix.c and patches/at_fdcwd.c replace posix.o and at_fdcwd.o.
# The full rebuild in
# build.sh (stage ~/.wasixcc, rebuild the libc++ runtimes) stays local:
# HOMESCOOP_WASIX_SYSROOT_FULL=1.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
VARIANTS=(sysroot sysroot-eh sysroot-ehpic sysroot-exnref-eh sysroot-exnref-ehpic)
PIC_VARIANTS=" sysroot-ehpic sysroot-exnref-ehpic "

# recipe.yaml source: the published -14 tarball, sha256-pinned.
homescoop_load_recipe wasix-sysroot
BASE_TGZ="$WORK/$(basename "$SRC_URL")"
BASE_VER="$(basename "$SRC_URL" .tgz)"
BASE_VER="${BASE_VER#wasix-sysroot-}"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$BASE_TGZ"

# Pinned WASIX toolchain (clang 21 + llvm-ar), in WORK so a developer's
# ~/.wasixcc is neither used nor touched.
PKG="$HOMESCOOP_PKG/package"
eval "$(bash "$ROOT/scripts/install-wasixcc.sh" "$WORK/wasixcc")"
CLANG="$WASIXCC_LLVM_LOCATION/bin/clang"
LLVM_AR="$WASIXCC_LLVM_LOCATION/bin/llvm-ar"
RES="$("$CLANG" -print-resource-dir)"
test -x "$CLANG" && test -x "$LLVM_AR" && test -d "$RES"

echo "== wasix-sysroot: base @ai-ecoverse/wasix-sysroot@$BASE_VER"
BASE="$WORK/wasix-sysroot-base"
rm -rf "$BASE" && mkdir -p "$BASE"
tar xzf "$BASE_TGZ" -C "$BASE" --no-same-owner
for v in "${VARIANTS[@]}"; do
  test -f "$BASE/package/$v/lib/wasm32-wasip1/libc.a"
  rm -rf "${PKG:?}/$v"
  cp -R "$BASE/package/$v" "$PKG/$v"
done

echo "== wasix-sysroot: compile slicc_stat_owner.c"
STAT_SRC="$HOMESCOOP_PKG/slicc_stat_owner.c"
OBJ="$WORK/stat-owner"
rm -rf "$OBJ" && mkdir -p "$OBJ/static" "$OBJ/pic"
compile_stat() {
  local out=$1; shift
  "$CLANG" --target=wasm32-wasip1 --sysroot="$PKG/sysroot" -resource-dir="$RES" \
    -I"$PKG/sysroot/include" \
    -matomics -mbulk-memory -mmutable-globals -pthread \
    -fno-trapping-math -ftls-model=local-exec \
    -msimd128 -mrelaxed-simd -mextended-const -O2 \
    "$@" -c "$STAT_SRC" -o "$out"
  test -s "$out"
}
# The archive member must be named slicc_stat_owner.o in both flavours.
compile_stat "$OBJ/static/slicc_stat_owner.o"
compile_stat "$OBJ/pic/slicc_stat_owner.o" -fPIC -fvisibility=default

echo "== wasix-sysroot: inject slicc_stat_owner.o into every libc.a"
for v in "${VARIANTS[@]}"; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  flavour=static
  [[ "$PIC_VARIANTS" == *" $v "* ]] && flavour=pic
  # List first: grep -q closing the pipe early would fail llvm-ar (pipefail).
  before="$("$LLVM_AR" t "$lib")"
  grep -qx fstat.o <<<"$before" || { echo "homescoop: $lib has no fstat.o (not -14?)" >&2; exit 1; }
  "$LLVM_AR" d "$lib" fstat.o fstatat.o
  "$LLVM_AR" r "$lib" "$OBJ/$flavour/slicc_stat_owner.o"
  members="$("$LLVM_AR" t "$lib")"
  grep -qx slicc_stat_owner.o <<<"$members"
  if grep -qxE 'fstat\.o|fstatat\.o' <<<"$members"; then
    echo "homescoop: $lib still has fstat.o/fstatat.o" >&2
    exit 1
  fi
  echo "  $v ($flavour)"
done

# -16: file modes through the kernel's slicc_fs imports (slicc-kernel#197).
# Upstream v2025-09-02.1 sources with chmod/fchmod/fchmodat/umask and
# create modes added; see patches/README.md. Same target features as the
# shipped posix.o (no simd), so the objects stay link-compatible.
echo "== wasix-sysroot: compile slicc_fs posix.c / at_fdcwd.c"
FS_OBJ="$WORK/slicc-fs"
rm -rf "$FS_OBJ" && mkdir -p "$FS_OBJ/static" "$FS_OBJ/pic"
compile_fs() {
  local src=$1 out=$2; shift 2
  "$CLANG" --target=wasm32-wasip1 --sysroot="$PKG/sysroot" -resource-dir="$RES" \
    -I"$PKG/sysroot/include" \
    -matomics -mbulk-memory -mmutable-globals -pthread \
    -fno-trapping-math -ftls-model=local-exec -O2 \
    "$@" -c "$HOMESCOOP_PKG/patches/$src.c" -o "$out"
  test -s "$out"
}
for src in posix at_fdcwd; do
  compile_fs "$src" "$FS_OBJ/static/$src.o"
  compile_fs "$src" "$FS_OBJ/pic/$src.o" -fPIC -fvisibility=default
done
LLVM_NM="$WASIXCC_LLVM_LOCATION/bin/llvm-nm"
defined() { "$LLVM_NM" --defined-only -j "$1" | sort -u; }

echo "== wasix-sysroot: replace posix.o and at_fdcwd.o in every libc.a"
for v in "${VARIANTS[@]}"; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  flavour=static
  [[ "$PIC_VARIANTS" == *" $v "* ]] && flavour=pic
  old="$WORK/slicc-fs/old-$v"
  rm -rf "$old" && mkdir -p "$old"
  (cd "$old" && "$LLVM_AR" x "$lib" posix.o at_fdcwd.o)
  for src in posix at_fdcwd; do
    # The patched file must define everything the shipped object did: a
    # mismatch means the base libc is not v2025-09-02.1.
    missing="$(comm -23 <(defined "$old/$src.o") <(defined "$FS_OBJ/$flavour/$src.o"))"
    if [[ -n "$missing" ]]; then
      echo "homescoop: $v $src.o: patched source lacks: $missing" >&2
      exit 1
    fi
  done
  "$LLVM_AR" r "$lib" "$FS_OBJ/$flavour/posix.o" "$FS_OBJ/$flavour/at_fdcwd.o"
  undef="$("$LLVM_NM" -u "$lib" 2>/dev/null)"
  grep -q __slicc_fs_fd_chmod <<<"$undef" || { echo "homescoop: $lib lacks slicc_fs imports" >&2; exit 1; }
  echo "  $v ($flavour)"
done

homescoop_assert_no_package_links "$PKG"
echo "== wasix-sysroot: staged $(node -p "require('$PKG/package.json').version") from $BASE_VER"
