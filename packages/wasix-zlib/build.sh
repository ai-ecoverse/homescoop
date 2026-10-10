#!/usr/bin/env bash
# wasix-zlib: zlib compiled with the pinned wasixcc in two flavours,
# lib/ (static, non-PIC) and lib-pic/ (-fPIC), plus headers and pkg-config.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasix-zlib

TB="$WORK/zlib-$VERSION.tar.gz"
SRC="$WORK/wasix-zlib-$VERSION"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"
rm -rf "$SRC" && mkdir -p "$SRC"
tar xzf "$TB" -C "$SRC" --strip-components=1

# The pinned toolchain in WORK: a developer's ~/.wasixcc is neither used nor touched.
eval "$(bash "$ROOT/scripts/install-wasixcc.sh" "$WORK/wasixcc")"
DEST="$HOMESCOOP_PKG/package"
rm -rf "$DEST/lib" "$DEST/lib-pic" "$DEST/include"
mkdir -p "$DEST/include"
OBJS=(adler32 compress crc32 deflate gzclose gzlib gzread gzwrite infback inffast inflate inftrees trees uncompr zutil)
export WASIXCC_RUN_WASM_OPT=no

build_flavour() {
  # wasixcc only builds PIC with wasm exceptions (python's ehpic tree:
  # legacy EH); zlib itself has no setjmp, so the objects carry no EH code.
  local dir=$1 pic=$2 eh=no
  [[ "$pic" == yes ]] && eh=legacy
  local out="$WORK/zlib-objs-$dir"
  rm -rf "$out" && mkdir -p "$out" "$DEST/$dir/pkgconfig"
  local o
  for o in "${OBJS[@]}"; do
    WASIXCC_PIC=$pic WASIXCC_WASM_EXCEPTIONS=$eh wasixcc -O2 -D_LARGEFILE64_SOURCE=1 -DHAVE_HIDDEN \
      -c "$SRC/$o.c" -o "$out/$o.o"
  done
  rm -f "$DEST/$dir/libz.a"
  local o objs=()
  for o in "${OBJS[@]}"; do objs+=("$out/$o.o"); done
  wasixar rcs "$DEST/$dir/libz.a" "${objs[@]}"
  # Paths relative to the .pc file: <pkg>/<dir>/pkgconfig/zlib.pc.
  cat >"$DEST/$dir/pkgconfig/zlib.pc" <<PC
prefix=\${pcfiledir}/../..
libdir=\${prefix}/$dir
includedir=\${prefix}/include

Name: zlib
Description: zlib compression library (homescoop WASIX, $dir)
Version: $VERSION
Libs: -L\${libdir} -lz
Cflags: -I\${includedir}
PC
  echo "== wasix-zlib: $dir/libz.a ($(wc -c <"$DEST/$dir/libz.a" | tr -d ' ') bytes)"
}
build_flavour lib no
build_flavour lib-pic yes
cp "$SRC/zlib.h" "$SRC/zconf.h" "$DEST/include/"

homescoop_stage_licenses "$SRC/LICENSE"
homescoop_notices_begin "libz.a (both flavours) is zlib itself (LICENSE); it is compiled against and meant to be linked with the following."
WLIBC=https://raw.githubusercontent.com/wasix-org/wasix-libc/v2025-09-02.1
homescoop_notice "wasix-libc headers (@ai-ecoverse/wasix-sysroot 2025.9.30-17; files from tag v2025-09-02.1)" \
  "$WLIBC/LICENSE" da1128117561950db9e04201ce9ac3f0bd9e3baf852289211608b73098d51ac0 \
  "$WLIBC/LICENSE-MIT" 23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3 \
  "$WLIBC/libc-top-half/musl/COPYRIGHT" f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af
homescoop_assert_no_package_links "$DEST"
echo "== wasix-zlib: staged $VERSION"
