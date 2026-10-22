#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe emscripten-cache
PKG="$HOMESCOOP_PKG/package"
PKG_VER="$(node -p 'require(process.argv[1]).version' "$PKG/package.json")"
TB="$WORK/emscripten-$VERSION.tar.gz"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"
eval "$(bash "$ROOT/scripts/emscripten-tree.sh" "$WORK/emscripten-cache-tree" "$TB")"
EM="$EMSCRIPTEN_TREE"
CFG="$EMSCRIPTEN_TREE_CONFIG"
CACHE="$EMSCRIPTEN_TREE_CACHE"
grep -q '__bits\[128/sizeof(long)\]' "$EM/system/lib/libc/musl/arch/emscripten/bits/alltypes.h"

LIBS=()
while IFS= read -r l; do [[ -n "$l" ]] && LIBS+=("$l"); done < "$HOMESCOOP_PKG/libs.txt"
echo "== emscripten-cache: embuilder build ${#LIBS[@]} libraries"
EM_CONFIG="$CFG" EMCC_CORES="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
  python3 "$EM/embuilder.py" build "${LIBS[@]}"
LIBDIR="$CACHE/sysroot/lib/wasm32-emscripten"
for l in "${LIBS[@]}"; do
  case "$l" in
    crt1 | crt1_reactor) test -f "$LIBDIR/$l.o" ;;
    *) test -f "$LIBDIR/$l.a" ;;
  esac
done
echo "== emscripten-cache: embuilder build --pic the same ${#LIBS[@]} libraries, for -sMAIN_MODULE links (homescoop#1699)"
EM_CONFIG="$CFG" EMCC_CORES="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
  python3 "$EM/embuilder.py" --pic build "${LIBS[@]}"
for l in "${LIBS[@]}"; do
  case "$l" in
    crt1 | crt1_reactor) test -f "$LIBDIR/pic/$l.o" ;;
    *) test -f "$LIBDIR/pic/$l.a" ;;
  esac
done
test -f "$CACHE/sysroot_install.stamp"
grep -q '__bits\[128/sizeof(long)\]' "$CACHE/sysroot/include/bits/alltypes.h"

echo "== emscripten-cache: stage sysroot → package ($PKG_VER)"
rm -rf "$PKG/sysroot" "$PKG/stamps" "$PKG/sanity.txt"
mkdir -p "$PKG/stamps"
rsync -a --delete --copy-links --exclude=/cache.lock "$CACHE/sysroot/" "$PKG/sysroot/"
rm -rf "$PKG/sysroot/js_output" "$PKG/sysroot/symbol_lists"
homescoop_assert_no_package_links "$PKG/sysroot"
if grep -q '__bits\[2\]' "$PKG/sysroot/include/bits/alltypes.h"; then
  echo "homescoop: staged sysroot has sigset_t __bits[2] (stride-20 trap)" >&2
  exit 1
fi
cp "$CACHE/sysroot_install.stamp" "$PKG/stamps/sysroot_install.stamp"
cp "$EM/LICENSE" "$PKG/LICENSE"
# THIRD-PARTY-NOTICES.md (homescoop#1030): the licences of the code compiled
# into the sysroot's libraries. Emscripten's LICENSE names musl's and LLVM's
# files without shipping them.
homescoop_notices_begin "The libraries in sysroot/lib/wasm32-emscripten are compiled from the following."
homescoop_notice "musl (libc.a, libc-debug.a; MIT)" "$EM/system/lib/libc/musl/COPYRIGHT" -
for part in libcxx:libc++ libcxxabi:libc++abi libunwind:libunwind compiler-rt:libclang_rt.builtins llvm-libc:libc; do
  dir=${part%%:*}
  homescoop_notice "LLVM $dir (${part#*:}; Apache-2.0 WITH LLVM-exception)" "$EM/system/lib/$dir/LICENSE.TXT" -
done
sed -n '/^ This is a version (aka dlmalloc)/,/^ \* Version 2/p' "$EM/system/lib/dlmalloc.c" > "$WORK/dlmalloc-notice.txt"
grep -q 'public domain' "$WORK/dlmalloc-notice.txt"
homescoop_notice "dlmalloc 2.8.6 by Doug Lea (libdlmalloc*.a; public domain, CC0)" "$WORK/dlmalloc-notice.txt" -
homescoop_notice "Emscripten 6.0.9 (emmalloc, GL, html5, OpenAL, sockets, embind, stubs, crt1; MIT or University of Illinois/NCSA)" "$EM/LICENSE" -
printf '%s\n' "$PKG_VER" > "$PKG/sysroot/.homescoop-emscripten-cache"
cp "$EM/emscripten-version.txt" "$PKG/EMSCRIPTEN_VERSION"
du -sh "$PKG/sysroot"
echo "OK emscripten-cache $PKG_VER"
