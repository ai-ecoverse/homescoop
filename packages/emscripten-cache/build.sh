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
printf '%s\n' "$PKG_VER" > "$PKG/sysroot/.homescoop-emscripten-cache"
cp "$EM/emscripten-version.txt" "$PKG/EMSCRIPTEN_VERSION"
du -sh "$PKG/sysroot"
echo "OK emscripten-cache $PKG_VER"
